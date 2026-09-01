/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Wallet Standard discovery, and the `SolanaProvider` adapter over it.
 *
 * `platforms/solana/walletStandard.ts` keeps module-scope state (the
 * discovered-wallets registry, and a `register-wallet` listener attached once
 * at import time) — real requirements of the protocol it implements, not a
 * design choice this file works around. Each scenario below therefore gets
 * its own fresh module instance via `jest.resetModules()` + a dynamic
 * `require()`, or a wallet registered in one test would leak into the next's
 * `detectStandardWallets()` result. A stray extra `window` listener from an
 * earlier test's now-orphaned module instance is harmless: nothing reads its
 * `discovered` array once the test that created it has finished.
 */
import bs58 from 'bs58'
import type { StandardWallet } from '@/platforms/solana/walletStandard'

/** A minimal but fully usable fake wallet — passes `isUsableSolanaWallet`. */
function makeFakeWallet(overrides: Partial<StandardWallet> = {}): StandardWallet {
    return {
        name: 'FakeCore',
        chains: ['solana:mainnet'],
        features: {
            'standard:connect': { connect: async () => ({ accounts: [] }) },
            'solana:signAndSendTransaction': { signAndSendTransaction: async () => [] },
        },
        ...overrides,
    } as StandardWallet
}

/** Dispatches the event a wallet fires on its own load, self-announcing. */
function selfAnnounce(wallet: StandardWallet): void {
    window.dispatchEvent(
        new CustomEvent('wallet-standard:register-wallet', {
            detail: (api: { register: (...wallets: StandardWallet[]) => () => void }) =>
                api.register(wallet),
        })
    )
}

describe('discovering Wallet Standard wallets', () => {
    let walletStandard: typeof import('@/platforms/solana/walletStandard')

    beforeEach(() => {
        jest.resetModules()
        walletStandard = require('@/platforms/solana/walletStandard')
    })

    it('finds a wallet that announces itself after this module has loaded', () => {
        // The common real-world ordering: this app's bundle (and so this
        // module's `register-wallet` listener) is already parsed by the time
        // an extension's content script runs and self-announces.
        selfAnnounce(makeFakeWallet())

        const names = walletStandard.detectStandardWallets().map((w) => w.name)
        expect(names).toEqual(['FakeCore'])
    })

    /**
     * The protocol's other half: a wallet that loaded and self-announced
     * BEFORE this app's own listener existed — `register-wallet` already
     * happened, unheard. A well-behaved wallet also listens for the app's own
     * `wallet-standard:app-ready` announcement precisely to cover this case;
     * `detectStandardWallets` dispatches it on every call.
     */
    it('finds a wallet that was already loaded, via the app-ready handshake', () => {
        // Simulates the wallet's own app-ready handler directly, since our
        // fake has no real extension script to run one for it.
        const onAppReady = ((event: CustomEvent) => {
            event.detail.register(makeFakeWallet({ name: 'AlreadyLoaded' }))
        }) as EventListener
        window.addEventListener('wallet-standard:app-ready', onAppReady)

        try {
            const names = walletStandard.detectStandardWallets().map((w) => w.name)
            expect(names).toEqual(['AlreadyLoaded'])
        } finally {
            window.removeEventListener('wallet-standard:app-ready', onAppReady)
        }
    })

    it('excludes a wallet with no Solana chain', () => {
        selfAnnounce(makeFakeWallet({ name: 'EvmOnly', chains: ['eip155:1'] }))
        expect(walletStandard.detectStandardWallets()).toEqual([])
    })

    it('excludes a wallet that cannot sign and send, even if it can connect', () => {
        selfAnnounce(
            makeFakeWallet({
                name: 'ConnectOnly',
                features: { 'standard:connect': { connect: async () => ({ accounts: [] }) } },
            })
        )
        expect(walletStandard.detectStandardWallets()).toEqual([])
    })
})

describe('the SolanaProvider adapter over a Wallet Standard wallet', () => {
    let walletStandard: typeof import('@/platforms/solana/walletStandard')

    beforeEach(() => {
        jest.resetModules()
        walletStandard = require('@/platforms/solana/walletStandard')
    })

    it('connects, reporting the account address as publicKey', async () => {
        const account = {
            address: 'AbC123',
            publicKey: new Uint8Array(32),
            chains: ['solana:mainnet'],
            features: [],
        }
        let connectCalls = 0
        selfAnnounce(
            makeFakeWallet({
                features: {
                    'standard:connect': {
                        connect: async () => {
                            connectCalls++
                            return { accounts: [account] }
                        },
                    },
                    'solana:signAndSendTransaction': { signAndSendTransaction: async () => [] },
                },
            })
        )

        const detected = walletStandard.detectStandardSolanaProvider()
        expect(detected).not.toBeNull()

        const { publicKey } = await detected!.provider.connect()
        expect(publicKey.toString()).toBe('AbC123')
        expect(connectCalls).toBe(1)
    })

    it('sends a transaction and base58-encodes the returned signature', async () => {
        const sigBytes = new Uint8Array([1, 2, 3, 4])
        const account = {
            address: 'Signer1',
            publicKey: new Uint8Array(32),
            chains: ['solana:mainnet'],
            features: [],
        }
        let sentBytes: Uint8Array | null = null

        selfAnnounce(
            makeFakeWallet({
                features: {
                    'standard:connect': { connect: async () => ({ accounts: [account] }) },
                    'solana:signAndSendTransaction': {
                        signAndSendTransaction: async (input: { transaction: Uint8Array }) => {
                            sentBytes = input.transaction
                            return [{ signature: sigBytes }]
                        },
                    },
                },
            })
        )

        const detected = walletStandard.detectStandardSolanaProvider()!
        await detected.provider.connect()

        // Duck-typed: the adapter only ever calls `.serialize(...)` on what
        // it's handed, exactly what a real @solana/web3.js Transaction does.
        const fakeTransaction = {
            serialize: () => new Uint8Array([9, 9]),
        } as unknown as import('@solana/web3.js').Transaction

        const { signature } = await detected.provider.signAndSendTransaction(fakeTransaction)

        expect(sentBytes).toEqual(new Uint8Array([9, 9]))
        expect(signature).toBe(bs58.encode(sigBytes))
    })

    it('refuses to sign before connecting', async () => {
        selfAnnounce(
            makeFakeWallet({
                features: {
                    'standard:connect': { connect: async () => ({ accounts: [] }) },
                    'solana:signAndSendTransaction': { signAndSendTransaction: async () => [] },
                    'solana:signMessage': {
                        signMessage: async () => [{ signedMessage: new Uint8Array(), signature: new Uint8Array() }],
                    },
                },
            })
        )
        const detected = walletStandard.detectStandardSolanaProvider()!

        await expect(detected.provider.signMessage(new Uint8Array([1]))).rejects.toThrow(
            /not connected/i
        )
    })

    /**
     * Wallet Standard defines one `change` event carrying whatever changed
     * (accounts, chains, features); the app's own listeners expect Phantom's
     * two discrete events instead. An empty `accounts` array in a `change` is
     * how a Wallet Standard wallet reports the site was disconnected from
     * inside the extension — the protocol has no separate disconnect event to
     * report it with.
     */
    it('bridges a Wallet Standard change event to accountChanged and disconnect', async () => {
        const accountA = {
            address: 'AddrA',
            publicKey: new Uint8Array(32),
            chains: ['solana:mainnet'],
            features: [],
        }
        // A list, not a single slot: the adapter subscribes once per
        // `on(event, handler)` call, and the test below registers two
        // (`accountChanged` and `disconnect`) — a real Wallet Standard
        // `events.on` supports any number of concurrent listeners.
        const changeListeners = new Set<(properties: { accounts?: unknown[] }) => void>()
        const fireChange = (properties: { accounts?: unknown[] }) =>
            changeListeners.forEach((l) => l(properties))

        selfAnnounce(
            makeFakeWallet({
                features: {
                    'standard:connect': { connect: async () => ({ accounts: [accountA] }) },
                    'solana:signAndSendTransaction': { signAndSendTransaction: async () => [] },
                    'standard:events': {
                        on: (_event: 'change', listener: any) => {
                            changeListeners.add(listener)
                            return () => changeListeners.delete(listener)
                        },
                    },
                },
            })
        )

        const detected = walletStandard.detectStandardSolanaProvider()!
        await detected.provider.connect()

        const accountChanged = jest.fn()
        const disconnected = jest.fn()
        detected.provider.on!('accountChanged', accountChanged)
        detected.provider.on!('disconnect', disconnected)

        const accountB = {
            address: 'AddrB',
            publicKey: new Uint8Array(32),
            chains: ['solana:mainnet'],
            features: [],
        }
        fireChange({ accounts: [accountB] })
        expect(accountChanged).toHaveBeenCalledTimes(1)
        expect((accountChanged.mock.calls[0][0] as { toString(): string }).toString()).toBe(
            'AddrB'
        )
        expect(disconnected).not.toHaveBeenCalled()

        fireChange({ accounts: [] })
        expect(disconnected).toHaveBeenCalledTimes(1)

        detected.provider.removeListener!('accountChanged', accountChanged)
        detected.provider.removeListener!('disconnect', disconnected)
        expect(changeListeners.size).toBe(0)
    })
})

describe('detectSolanaProvider (provider.ts) falling back to the Wallet Standard', () => {
    beforeEach(() => {
        jest.resetModules()
    })

    it('prefers a legacy window.solana-shaped provider when both are present', () => {
        const w = window as any
        w.solana = {
            connect: async () => ({ publicKey: { toString: () => 'legacy' } }),
            signAndSendTransaction: async () => ({ signature: 'sig' }),
        }
        try {
            const { detectSolanaProvider } = require('@/platforms/solana/provider')
            expect(detectSolanaProvider()?.provider).toBe(w.solana)
        } finally {
            delete w.solana
        }
    })

    it('falls back to a Wallet Standard wallet when no legacy handle is present', () => {
        // Loading provider.ts pulls in walletStandard.ts, attaching its
        // `register-wallet` listener — then the wallet announces.
        const { detectSolanaProvider } = require('@/platforms/solana/provider')
        selfAnnounce(makeFakeWallet({ name: 'CoreViaStandard' }))

        expect(detectSolanaProvider()?.name).toBe('CoreViaStandard')
    })
})
