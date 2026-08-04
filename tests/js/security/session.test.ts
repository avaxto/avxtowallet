import { SessionVault } from '@/js/security/SessionVault'
import { secretFromString, secretToString } from '@/js/security/memory'
import {
    AuthScope,
    AuthHandle,
    SessionAuthCancelled,
    SessionBusy,
    NotAuthorized,
    withAuthorization,
    requireAuth,
    isScopeActive,
    onScopeClosed,
    __resetSessionForTests,
    __setPromptForTests,
} from '@/js/security/session'

import { webcrypto } from 'crypto'

// Drive authorization through the injected prompt seam rather than rendering
// the modal, so these tests cover scope and disposal semantics only.
const mockPrompt = jest.fn<Promise<CryptoKey | null>, [any, string, (string | undefined)?]>()

beforeAll(() => {
    if (!globalThis.crypto?.subtle) {
        Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
    }
})

const PASSWORD = 'correct horse battery staple'
const SEED = 'seed material'

async function makeVault(): Promise<SessionVault> {
    const vault = new SessionVault()
    const key = await vault.deriveKey(PASSWORD)
    await vault.put({ getKey: () => key }, 'seed', secretFromString(SEED))
    return vault
}

/** Prompt that always supplies the given password. */
function answerWith(vault: SessionVault, password: string) {
    mockPrompt.mockImplementation(async () => vault.deriveKey(password))
}

beforeEach(() => {
    __resetSessionForTests()
    mockPrompt.mockReset()
    __setPromptForTests(mockPrompt as any)
})

describe('withAuthorization', () => {
    it('prompts once and grants access to the secret', async () => {
        const vault = await makeVault()
        answerWith(vault, PASSWORD)

        const got = await withAuthorization(
            { scope: AuthScope.SINGLE, reason: 'Send', vault },
            (auth) => vault.withSecret(auth, 'seed', (pt) => secretToString(pt))
        )

        expect(got).toBe(SEED)
        expect(mockPrompt).toHaveBeenCalledTimes(1)
    })

    it('disposes the handle after the operation, so it cannot be reused', async () => {
        const vault = await makeVault()
        answerWith(vault, PASSWORD)

        let escaped: AuthHandle | null = null
        await withAuthorization({ scope: AuthScope.SINGLE, reason: 'Send', vault }, async (auth) => {
            escaped = auth
        })

        expect(escaped!.isDisposed).toBe(true)
        expect(() => escaped!.getKey()).toThrow(NotAuthorized)
        await expect(vault.withSecret(escaped!, 'seed', () => 'x')).rejects.toThrow(NotAuthorized)
    })

    it('disposes the handle even when the operation throws', async () => {
        const vault = await makeVault()
        answerWith(vault, PASSWORD)

        let escaped: AuthHandle | null = null
        await expect(
            withAuthorization({ scope: AuthScope.SINGLE, reason: 'Send', vault }, async (auth) => {
                escaped = auth
                throw new Error('user rejected')
            })
        ).rejects.toThrow('user rejected')

        expect(escaped!.isDisposed).toBe(true)
        expect(isScopeActive()).toBe(false)
    })

    it('re-prompts on a wrong password and succeeds once corrected', async () => {
        const vault = await makeVault()
        mockPrompt
            .mockImplementationOnce(async () => vault.deriveKey('wrong'))
            .mockImplementationOnce(async () => vault.deriveKey(PASSWORD))

        const got = await withAuthorization(
            { scope: AuthScope.SINGLE, reason: 'Send', vault },
            (auth) => vault.withSecret(auth, 'seed', (pt) => secretToString(pt))
        )

        expect(got).toBe(SEED)
        expect(mockPrompt).toHaveBeenCalledTimes(2)
        // Second call must carry the error text back to the modal.
        expect(mockPrompt.mock.calls[1][2]).toMatch(/incorrect/i)
    })

    it('verifies the password before running the operation', async () => {
        const vault = await makeVault()
        mockPrompt
            .mockImplementationOnce(async () => vault.deriveKey('wrong'))
            .mockImplementationOnce(async () => vault.deriveKey(PASSWORD))

        const fn = jest.fn(async () => 'done')
        await withAuthorization({ scope: AuthScope.SINGLE, reason: 'Send', vault }, fn)

        // Never invoked with an unusable key — critical for cross-chain, where
        // a mid-flow failure could strand an export.
        expect(fn).toHaveBeenCalledTimes(1)
    })

    it('throws SessionAuthCancelled when the user dismisses the prompt', async () => {
        const vault = await makeVault()
        mockPrompt.mockResolvedValue(null)

        const fn = jest.fn()
        await expect(
            withAuthorization({ scope: AuthScope.SINGLE, reason: 'Send', vault }, fn)
        ).rejects.toThrow(SessionAuthCancelled)

        expect(fn).not.toHaveBeenCalled()
        expect(isScopeActive()).toBe(false)
    })
})

describe('scope reuse', () => {
    it('a batch prompts once for many signatures', async () => {
        const vault = await makeVault()
        answerWith(vault, PASSWORD)

        const results: string[] = []
        await withAuthorization({ scope: AuthScope.BATCH, reason: 'Batch send', vault }, async () => {
            for (let i = 0; i < 5; i++) {
                // Each transaction opens its own nested scope, as the signing
                // primitives will.
                const r = await withAuthorization(
                    { scope: AuthScope.SINGLE, reason: `tx ${i}`, vault },
                    (auth) => vault.withSecret(auth, 'seed', (pt) => secretToString(pt))
                )
                results.push(r)
            }
        })

        expect(results).toEqual(Array(5).fill(SEED))
        expect(mockPrompt).toHaveBeenCalledTimes(1)
    })

    it('a cross-chain scope survives an await between the two signatures', async () => {
        const vault = await makeVault()
        answerWith(vault, PASSWORD)

        const seen: string[] = []
        await withAuthorization(
            { scope: AuthScope.CROSSCHAIN, reason: 'Transfer X to P', vault },
            async () => {
                seen.push(
                    await withAuthorization(
                        { scope: AuthScope.SINGLE, reason: 'export', vault },
                        (a) => vault.withSecret(a, 'seed', (pt) => secretToString(pt))
                    )
                )
                await new Promise((r) => setTimeout(r, 10))
                seen.push(
                    await withAuthorization(
                        { scope: AuthScope.SINGLE, reason: 'import', vault },
                        (a) => vault.withSecret(a, 'seed', (pt) => secretToString(pt))
                    )
                )
            }
        )

        expect(seen).toEqual([SEED, SEED])
        expect(mockPrompt).toHaveBeenCalledTimes(1)
    })

    it('a nested scope does not dispose the outer authorization early', async () => {
        const vault = await makeVault()
        answerWith(vault, PASSWORD)

        await withAuthorization({ scope: AuthScope.BATCH, reason: 'Batch', vault }, async (outer) => {
            await withAuthorization({ scope: AuthScope.SINGLE, reason: 'tx', vault }, async () => {})
            expect(outer.isDisposed).toBe(false)
            expect(() => outer.getKey()).not.toThrow()
        })
    })

    it('refuses to let a different wallet ride on an open authorization', async () => {
        const vaultA = await makeVault()
        const vaultB = await makeVault()
        answerWith(vaultA, PASSWORD)

        await expect(
            withAuthorization({ scope: AuthScope.BATCH, reason: 'A', vault: vaultA }, async () => {
                await withAuthorization(
                    { scope: AuthScope.SINGLE, reason: 'B', vault: vaultB },
                    async () => 'should not happen'
                )
            })
        ).rejects.toThrow(SessionBusy)
    })
})

describe('requireAuth', () => {
    it('throws outside any scope', () => {
        expect(() => requireAuth()).toThrow(NotAuthorized)
    })

    it('returns the ambient handle inside a scope', async () => {
        const vault = await makeVault()
        answerWith(vault, PASSWORD)

        await withAuthorization({ scope: AuthScope.SINGLE, reason: 'Send', vault }, async (auth) => {
            expect(requireAuth()).toBe(auth)
            expect(requireAuth(vault)).toBe(auth)
        })

        expect(() => requireAuth()).toThrow(NotAuthorized)
    })

    it('rejects a mismatched vault', async () => {
        const vaultA = await makeVault()
        const vaultB = await makeVault()
        answerWith(vaultA, PASSWORD)

        await withAuthorization(
            { scope: AuthScope.SINGLE, reason: 'Send', vault: vaultA },
            async () => {
                expect(() => requireAuth(vaultB)).toThrow(SessionBusy)
            }
        )
    })
})

describe('scope close notifications', () => {
    it('fires only when the outermost scope closes', async () => {
        const vault = await makeVault()
        answerWith(vault, PASSWORD)

        const closed = jest.fn()
        const off = onScopeClosed(closed)

        await withAuthorization({ scope: AuthScope.BATCH, reason: 'Batch', vault }, async () => {
            await withAuthorization({ scope: AuthScope.SINGLE, reason: 'tx', vault }, async () => {})
            expect(closed).not.toHaveBeenCalled()
        })

        expect(closed).toHaveBeenCalledTimes(1)
        off()
    })

    it('fires even when the operation throws', async () => {
        const vault = await makeVault()
        answerWith(vault, PASSWORD)

        const closed = jest.fn()
        const off = onScopeClosed(closed)

        await expect(
            withAuthorization({ scope: AuthScope.SINGLE, reason: 'Send', vault }, async () => {
                throw new Error('nope')
            })
        ).rejects.toThrow('nope')

        expect(closed).toHaveBeenCalledTimes(1)
        off()
    })
})
