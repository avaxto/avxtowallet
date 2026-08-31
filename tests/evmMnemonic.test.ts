/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Opening the EVM platform from a recovery phrase.
 *
 * The EVM platform used to be extension-only, so a user opening Bitcoin, Solana
 * and Avalanche from one phrase at `/access/multi` silently got no EVM session
 * — despite the same phrase being a perfectly good credential on every EVM
 * chain. What that added is a wallet this app holds the seed for, which puts
 * two things under test that the injected wallet never needed:
 *
 *  1. **The address must be the account the phrase really opens.** A wrong
 *     derivation path shows a valid, empty, wrong wallet — the user's funds are
 *     not lost, but they are invisible, and anything sent to the displayed
 *     address lands in an account they cannot reach from any other wallet. So
 *     the path is pinned to published vectors, and to the path Avalanche's own
 *     C-Chain key uses, since one phrase now opens both tabs at once and they
 *     must agree.
 *
 *  2. **Signing must stay behind the session password.** The key is re-derived
 *     per signature from the vaulted seed; reaching a signing primitive outside
 *     an authorized scope has to throw rather than sign.
 *
 * The platform object itself is not imported here: `platforms/evm/index.ts`
 * pulls in the store, which pulls in the router and every view, and the
 * registry then double-registers. Same reason platformSwitching and
 * multiPlatformUnlock use fakes for the registry contract — this file is about
 * the derivation and the wallet, which are the parts a bug would be expensive
 * in.
 */
import { webcrypto } from 'crypto'
import * as bip39 from 'bip39'
import HDKey from 'hdkey'
import { Buffer as BufferNative } from 'buffer'
import { importPublic, publicToAddress, toChecksumAddress } from 'ethereumjs-util'
import { recoverPersonalSignature } from '@metamask/eth-sig-util'

import { SessionVault } from '@/js/security/SessionVault'
import {
    AuthHandle,
    AuthScope,
    withAuthorization,
    __resetSessionForTests,
    __setPromptForTests,
} from '@/js/security/session'
import { wipe } from '@/js/security/memory'
import {
    DEFAULT_EVM_PATH,
    ETH_ACCOUNT_PATH,
    deriveEvmAddress,
    deriveEvmPrivateKey,
    evmAccountPath,
    evmAddressFromPrivateKey,
    isValidEvmAddress,
} from '@/evm/keys'
import { getEvmNetworkByChainId, loadCustomEvmNetworks } from '@/evm/networkRegistry'
import type { EvmNetwork } from '@/evm/networkRegistry'
import { LocalEvmWallet, WatchEvmWallet } from '@/platforms/evm/wallet'

beforeAll(() => {
    if (!globalThis.crypto?.subtle) {
        Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
    }
})

loadCustomEvmNetworks()
const ETHEREUM = getEvmNetworkByChainId(1) as EvmNetwork

const PASSWORD = 'correct horse battery staple'
const MNEMONIC =
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

/**
 * The published address for this phrase at `m/44'/60'/0'/0/0` — what MetaMask,
 * Rabby and Ledger Live all open first. Hard-coded on purpose: a vector the
 * code cannot influence is the only thing that catches the path silently
 * changing.
 */
const ACCOUNT_0 = '0x9858EfFD232B4033E47d90003D41EC34EcaEda94'
const ACCOUNT_1 = '0x6Fac4D18c912343BF86fa7049364Dd4E424Ab9C0'

const mockPrompt = jest.fn()

beforeEach(() => {
    __resetSessionForTests()
    mockPrompt.mockReset()
    __setPromptForTests(mockPrompt as any)
})

const seedOf = async (mnemonic = MNEMONIC): Promise<Uint8Array> =>
    new Uint8Array(await bip39.mnemonicToSeed(mnemonic))

/** A real LocalEvmWallet with the test phrase's seed vaulted under PASSWORD. */
async function makeWallet(): Promise<LocalEvmWallet> {
    const vault = new SessionVault()
    const key = await vault.deriveKey(PASSWORD)
    const auth = new AuthHandle(AuthScope.SINGLE, vault, key)
    await vault.put(auth, 'seed', await seedOf())
    auth.dispose()

    mockPrompt.mockImplementation(async () => vault.deriveKey(PASSWORD))

    return new LocalEvmWallet({
        address: deriveEvmAddress(await seedOf(), DEFAULT_EVM_PATH),
        network: ETHEREUM,
        vault,
        derivationPath: DEFAULT_EVM_PATH,
    })
}

/**
 * Drives the low-level session primitive the wallet depends on
 * (`requireAuth`/`withAuthorization`) rather than the `authorizeSingle` wrapper,
 * which also touches the offline-signing Pinia store and needs a full app
 * context this unit test does not set up. Same approach as
 * bitcoinDeriveKnownSchemes.test.ts.
 */
function authorized<T>(wallet: LocalEvmWallet, fn: () => Promise<T>): Promise<T> {
    return withAuthorization({ scope: AuthScope.SINGLE, reason: 'test', vault: wallet.vault }, fn)
}

describe('deriving the EVM account from a phrase', () => {
    it('opens the account every other EVM wallet opens for this phrase', async () => {
        expect(deriveEvmAddress(await seedOf())).toBe(ACCOUNT_0)
    })

    it('derives later accounts at the standard index', async () => {
        expect(deriveEvmAddress(await seedOf(), evmAccountPath(1))).toBe(ACCOUNT_1)
    })

    /**
     * The property the tabbed wallet makes visible. One phrase now opens the
     * Avalanche tab and the EVM tab at the same time; if they derived their
     * 0x address differently the user would see two different C-Chain/EVM
     * addresses for one wallet and have no way to tell which was real.
     *
     * Re-derived here the way `MnemonicWallet` does it — from the *public* key,
     * through ethereumjs — so this is an independent check of the account, not
     * the module compared against itself.
     */
    it('lands on the same address Avalanche derives for its C-Chain key', async () => {
        const master = HDKey.fromMasterSeed(BufferNative.from(await seedOf()) as any)
        const node = master.derive(ETH_ACCOUNT_PATH + '/0/0')
        const avalancheStyle = toChecksumAddress(
            '0x' + publicToAddress(importPublic(node.publicKey)).toString('hex')
        )

        expect(deriveEvmAddress(await seedOf())).toBe(avalancheStyle)
        expect(DEFAULT_EVM_PATH).toBe(ETH_ACCOUNT_PATH + '/0/0')
    })

    it('returns EIP-55 checksummed addresses, not lowercase', async () => {
        const address = deriveEvmAddress(await seedOf())

        expect(address).not.toBe(address.toLowerCase())
        expect(address).toBe(toChecksumAddress(address))
        expect(isValidEvmAddress(address)).toBe(true)
    })

    /**
     * `hdkey` owns and reuses the buffer behind `node.privateKey`, and the
     * derivation wipes that node before returning. Handing back a reference to
     * it would give every caller a key that is already zeroed — or worse, one
     * that a later `wipe()` zeroes underneath a caller still using it.
     */
    it('hands back a private key the caller owns, not the node\'s own buffer', async () => {
        const first = deriveEvmPrivateKey(await seedOf(), DEFAULT_EVM_PATH)
        expect(evmAddressFromPrivateKey(first)).toBe(ACCOUNT_0)

        wipe(first)
        expect(first.every((b) => b === 0)).toBe(true)

        // The wipe above must not have damaged anything shared: deriving again
        // produces the same key.
        const second = deriveEvmPrivateKey(await seedOf(), DEFAULT_EVM_PATH)
        expect(evmAddressFromPrivateKey(second)).toBe(ACCOUNT_0)
        wipe(second)
    })

    it('rejects a phrase-shaped path with no private key rather than guessing', async () => {
        // A neutered path cannot exist from a seed, but a malformed one can —
        // and must fail loudly instead of yielding some other account.
        expect(() => deriveEvmAddress(new Uint8Array(64), 'not-a-path')).toThrow()
    })
})

describe('signing with a phrase-opened wallet', () => {
    it('refuses to sign outside an authorized scope', async () => {
        const wallet = await makeWallet()

        await expect(wallet.signMessage('hello')).rejects.toThrow()
        // Not even a password prompt: the gate is the ambient scope, and a
        // primitive reached directly must not be able to open one.
        expect(mockPrompt).not.toHaveBeenCalled()
    })

    /**
     * The end-to-end property: the key re-derived at signing time belongs to
     * the address the wallet displays. A path mismatch between "what we show"
     * and "what we sign with" would pass every other test in this file.
     */
    it('signs with the key belonging to the address it displays', async () => {
        const wallet = await makeWallet()
        const message = 'gm from the EVM tab'

        const signature = await authorized(wallet, () => wallet.signMessage(message))

        const hexMessage =
            '0x' +
            Array.from(new TextEncoder().encode(message))
                .map((b) => b.toString(16).padStart(2, '0'))
                .join('')
        const recovered = recoverPersonalSignature({ data: hexMessage, signature })

        expect(toChecksumAddress(recovered)).toBe(wallet.getPrimaryAddress())
        expect(wallet.getPrimaryAddress()).toBe(ACCOUNT_0)
    })

    it('is inert once disconnected clears the vault', async () => {
        const wallet = await makeWallet()
        wallet.vault.clear()

        await expect(authorized(wallet, () => wallet.signMessage('hello'))).rejects.toThrow()
    })

    /**
     * `assertOnChain` runs immediately before every send (see FormC.vue). The
     * injected wallet checks the extension's current chain there; this one has
     * no extension and folds the chain id into the signature instead, so it
     * must resolve rather than throw — a throw would mean a phrase-opened
     * wallet could never send at all.
     */
    it('has no chain to drift, so the pre-send guard passes', async () => {
        const wallet = await makeWallet()
        await expect(wallet.assertOnChain()).resolves.toBeUndefined()
    })

    it('reports itself as a signing wallet, gated on the vault', async () => {
        const wallet = await makeWallet()

        expect(wallet.isReadonly).toBe(false)
        expect(wallet.accessMethodId).toBe('mnemonic')
        // `authorizeWalletOp` authorizes on one of these two: a vault (prompt
        // for the password) or an externally-authorized `type`. This wallet
        // must qualify on the vault, NOT by claiming an injected type.
        expect(wallet.vault).toBeInstanceOf(SessionVault)
        expect(wallet.type).not.toBe('injected')
    })
})

describe('the wallet kinds that cannot sign', () => {
    it('refuses every signing path on a watch-only wallet', async () => {
        const watch = new WatchEvmWallet({ address: ACCOUNT_0, network: ETHEREUM })

        expect(watch.isReadonly).toBe(true)
        expect((watch as any).vault).toBeUndefined()
        await expect(watch.signMessage()).rejects.toThrow(/watch-only/i)
        await expect(watch.sendNative()).rejects.toThrow(/watch-only/i)
        await expect(watch.sendErc20()).rejects.toThrow(/watch-only/i)
    })
})
