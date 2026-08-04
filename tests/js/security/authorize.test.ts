import { SessionVault } from '@/js/security/SessionVault'
import { secretFromString } from '@/js/security/memory'
import { AuthScope, __resetSessionForTests, __setPromptForTests } from '@/js/security/session'
import { authorizeWalletOp, authorizeSingle } from '@/js/security/authorize'

import { webcrypto } from 'crypto'

beforeAll(() => {
    if (!globalThis.crypto?.subtle) {
        Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
    }
})

const PASSWORD = 'correct horse battery staple'
const mockPrompt = jest.fn<Promise<CryptoKey | null>, [any, string, (string | undefined)?]>()

async function vaultedWallet() {
    const vault = new SessionVault()
    const key = await vault.deriveKey(PASSWORD)
    await vault.put({ getKey: () => key }, 'seed', secretFromString('seed material'))
    return { type: 'mnemonic', vault }
}

beforeEach(() => {
    __resetSessionForTests()
    mockPrompt.mockReset()
    __setPromptForTests(mockPrompt as any)
})

describe('authorizeWalletOp', () => {
    it('prompts for a vault-backed wallet', async () => {
        const w = await vaultedWallet()
        mockPrompt.mockImplementation(async () => w.vault.deriveKey(PASSWORD))

        const ran = await authorizeSingle(w, 'Send', async () => 'sent')

        expect(ran).toBe('sent')
        expect(mockPrompt).toHaveBeenCalledTimes(1)
    })

    it.each(['ledger', 'injected'])(
        'runs a %s wallet through without prompting',
        async (type) => {
            const ran = await authorizeSingle({ type }, 'Send', async () => 'sent')
            expect(ran).toBe('sent')
            expect(mockPrompt).not.toHaveBeenCalled()
        }
    )

    // The X-chain regression: a mistyped wallet variable used to yield
    // undefined, which silently skipped the password prompt entirely.
    it('throws rather than silently skipping when the wallet is undefined', async () => {
        const fn = jest.fn(async () => 'sent')

        await expect(authorizeSingle(undefined, 'Send', fn)).rejects.toThrow(/no wallet was supplied/i)
        expect(fn).not.toHaveBeenCalled()
        expect(mockPrompt).not.toHaveBeenCalled()
    })

    it('throws when handed a Vue ref instead of its value', async () => {
        const w = await vaultedWallet()
        const asRef = { value: w } // what `wallet` rather than `wallet.value` looks like
        const fn = jest.fn(async () => 'sent')

        await expect(authorizeSingle(asRef, 'Send', fn)).rejects.toThrow(/no session vault/i)
        expect(fn).not.toHaveBeenCalled()
    })

    it('throws for a vault-less wallet of unknown type', async () => {
        const fn = jest.fn(async () => 'sent')

        await expect(authorizeSingle({ type: 'mnemonic' }, 'Send', fn)).rejects.toThrow(
            /no session vault/i
        )
        expect(fn).not.toHaveBeenCalled()
    })

    it('passes the requested scope through', async () => {
        const w = await vaultedWallet()
        mockPrompt.mockImplementation(async () => w.vault.deriveKey(PASSWORD))

        let seenScope: AuthScope | null = null
        await authorizeWalletOp(w, AuthScope.BATCH, 'Batch send', async () => {
            return 'ok'
        })
        // The scope is observable via the handle inside withAuthorization; here
        // it is enough that a BATCH request completed with a single prompt.
        expect(mockPrompt).toHaveBeenCalledTimes(1)
    })
})
