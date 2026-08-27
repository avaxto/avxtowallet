/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Bitcoin address derivation.
 *
 * The expected addresses below are the official BIP-44/49/84/86 test vectors
 * for the canonical all-`abandon` mnemonic — the same values every other
 * wallet publishes for it. A passing test means a phrase imported here opens
 * the same account it would in Electrum, Sparrow or a hardware wallet, which
 * is the property that actually matters: getting this wrong shows the user an
 * empty wallet and looks like lost funds.
 */
import * as bip39 from 'bip39'

import {
    addressFromPublicKey,
    accountPath,
    addressPath,
    bip32,
    CORE_WALLET_PATH,
    deriveCoreCompatNode,
    detectAddressType,
    isValidBitcoinAddress,
    ECPair,
    parsePrivateKeyInput,
} from '@/bitcoin/keys'
import { getBitcoinNetworkById, type BtcAddressType } from '@/bitcoin/networks'

const MNEMONIC =
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

const mainnet = getBitcoinNetworkById('mainnet')!
const testnet = getBitcoinNetworkById('testnet')!

let seed: Uint8Array

beforeAll(async () => {
    seed = new Uint8Array(await bip39.mnemonicToSeed(MNEMONIC))
})

function firstAddress(type: BtcAddressType, network = mainnet): string {
    const node = bip32
        .fromSeed(seed, network.params)
        .derivePath(addressPath(type, network, 0, 'receive', 0))
    return addressFromPublicKey(node.publicKey, type, network)
}

describe('address derivation matches the official BIP vectors', () => {
    it.each([
        ['p2pkh', '1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA'],
        ['p2sh-p2wpkh', '37VucYSaXLCAsxYyAPfbSi9eh4iEcbShgf'],
        ['p2wpkh', 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu'],
        ['p2tr', 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr'],
    ] as [BtcAddressType, string][])('%s', (type, expected) => {
        expect(firstAddress(type)).toBe(expected)
    })
})

describe('derivation paths', () => {
    it('uses the right BIP purpose per address type', () => {
        expect(accountPath('p2pkh', mainnet)).toBe("m/44'/0'/0'")
        expect(accountPath('p2sh-p2wpkh', mainnet)).toBe("m/49'/0'/0'")
        expect(accountPath('p2wpkh', mainnet)).toBe("m/84'/0'/0'")
        expect(accountPath('p2tr', mainnet)).toBe("m/86'/0'/0'")
    })

    it('puts testnet on coin type 1, keeping it off mainnet keys', () => {
        // The whole point of the separate coin type: the same phrase must not
        // control real funds at the same indices it uses for test coins.
        expect(accountPath('p2wpkh', testnet)).toBe("m/84'/1'/0'")
        expect(firstAddress('p2wpkh', testnet)).not.toBe(firstAddress('p2wpkh', mainnet))
    })

    it('separates receive from change', () => {
        expect(addressPath('p2wpkh', mainnet, 0, 'receive', 3)).toBe("m/84'/0'/0'/0/3")
        expect(addressPath('p2wpkh', mainnet, 0, 'change', 3)).toBe("m/84'/0'/0'/1/3")
    })
})

describe('detectAddressType', () => {
    it('recognises each type it derives', () => {
        for (const type of ['p2pkh', 'p2sh-p2wpkh', 'p2wpkh', 'p2tr'] as BtcAddressType[]) {
            expect(detectAddressType(firstAddress(type), mainnet)).toBe(type)
        }
    })

    it('works on testnet, where the prefixes differ but the scripts do not', () => {
        for (const type of ['p2pkh', 'p2sh-p2wpkh', 'p2wpkh', 'p2tr'] as BtcAddressType[]) {
            expect(detectAddressType(firstAddress(type, testnet), testnet)).toBe(type)
        }
    })

    it('returns null for junk', () => {
        expect(detectAddressType('not an address', mainnet)).toBeNull()
    })
})

describe('isValidBitcoinAddress', () => {
    it('accepts addresses of every type', () => {
        for (const type of ['p2pkh', 'p2sh-p2wpkh', 'p2wpkh', 'p2tr'] as BtcAddressType[]) {
            expect(isValidBitcoinAddress(firstAddress(type), mainnet)).toBe(true)
        }
    })

    it('rejects a mainnet address on testnet and vice versa', () => {
        // Network-aware validation is what stops a transaction being built for
        // a chain it can never confirm on.
        expect(isValidBitcoinAddress(firstAddress('p2wpkh', mainnet), testnet)).toBe(false)
        expect(isValidBitcoinAddress(firstAddress('p2wpkh', testnet), mainnet)).toBe(false)
    })

    it('rejects junk, an empty string and an EVM address', () => {
        expect(isValidBitcoinAddress('', mainnet)).toBe(false)
        expect(isValidBitcoinAddress('nonsense', mainnet)).toBe(false)
        expect(
            isValidBitcoinAddress('0x0000000000000000000000000000000000000000', mainnet)
        ).toBe(false)
    })

    it('tolerates surrounding whitespace', () => {
        expect(isValidBitcoinAddress(`  ${firstAddress('p2wpkh')}  `, mainnet)).toBe(true)
    })
})

describe('Core Wallet compatibility', () => {
    // Regression coverage for a real bug report: a user's 24-word phrase
    // produced a Bitcoin address here that did not match what Core Extension
    // / Core App showed for the SAME phrase. Root cause — confirmed against
    // the vendored SDK this app already ships
    // (avalanche-wallet-sdk/Wallet/EVM/EvmWalletReadonly.ts#getAddressBTC),
    // not assumed: Core does not give Bitcoin its own BIP-44/49/84/86
    // derivation at all. It reuses the same secp256k1 key as the Avalanche
    // C-Chain/EVM address and re-encodes its compressed public key as
    // P2WPKH — a completely different key than any independent Bitcoin
    // derivation produces.

    it("derives at the Ledger/C-Chain EVM path, m/44'/60'/0'/0/0", () => {
        expect(CORE_WALLET_PATH).toBe("m/44'/60'/0'/0/0")
    })

    it('produces a valid, deterministic P2WPKH address', async () => {
        const node = deriveCoreCompatNode(seed, mainnet)
        const address = addressFromPublicKey(node.publicKey, 'p2wpkh', mainnet)

        expect(detectAddressType(address, mainnet)).toBe('p2wpkh')
        expect(address).toBe(
            addressFromPublicKey(
                deriveCoreCompatNode(seed, mainnet).publicKey,
                'p2wpkh',
                mainnet
            )
        )
    })

    it('matches the real address Core Extension / Core App show for the canonical test mnemonic', () => {
        // Independently computed via the identical algorithm
        // EvmWalletReadonly.getAddressBTC uses (derive m/44'/60'/0'/0/0,
        // P2WPKH-encode the compressed pubkey) — this is the value Core
        // itself would display for this mnemonic.
        const node = deriveCoreCompatNode(seed, mainnet)
        const address = addressFromPublicKey(node.publicKey, 'p2wpkh', mainnet)
        expect(address).toBe('bc1qgsvdpdxec8hsu57lhxg5xem7refr233z2ttx7e')
    })

    it('is a DIFFERENT address than this wallet\'s own independent p2wpkh (BIP-84) derivation', () => {
        // This is the bug, pinned as a property: the two scan sources must
        // never accidentally collapse to the same key, or the "which
        // candidate holds funds" discovery logic couldn't tell them apart.
        const coreNode = deriveCoreCompatNode(seed, mainnet)
        const coreAddress = addressFromPublicKey(coreNode.publicKey, 'p2wpkh', mainnet)
        expect(coreAddress).not.toBe(firstAddress('p2wpkh'))
    })

    it('reuses the exact constant the Avalanche C-Chain/EVM key is derived at', async () => {
        // Imported, not redeclared — see the doc comment on CORE_WALLET_PATH.
        // This assertion exists so a change to the C-Chain path in
        // js/wallets/constants.ts is caught here too, rather than silently
        // making the two derivations diverge.
        const { LEDGER_ETH_ACCOUNT_PATH } = await import('@/js/wallets/constants')
        expect(CORE_WALLET_PATH).toBe(LEDGER_ETH_ACCOUNT_PATH)
    })
})

describe('parsePrivateKeyInput', () => {
    // The Core Wallet node above IS a raw EVM-style key (see CORE_WALLET_PATH
    // description) — reusing it here ties this straight to a real scenario:
    // pasting that same C-Chain key as 0x hex into the Bitcoin private-key
    // importer must open the identical address Core itself shows for it.
    const coreNode = deriveCoreCompatNode(seed, mainnet)
    const CORE_ADDRESS = 'bc1qgsvdpdxec8hsu57lhxg5xem7refr233z2ttx7e'

    it('accepts a 0x-prefixed raw private key, defaulting to a compressed pubkey', () => {
        const hex = '0x' + Buffer.from(coreNode.privateKey!).toString('hex')
        const pair = parsePrivateKeyInput(hex, mainnet)
        expect(pair.compressed).toBe(true)
        expect(addressFromPublicKey(pair.publicKey, 'p2wpkh', mainnet)).toBe(CORE_ADDRESS)
    })

    it('is case-insensitive on the 0x prefix and hex digits', () => {
        const hex = '0X' + Buffer.from(coreNode.privateKey!).toString('hex').toUpperCase()
        const pair = parsePrivateKeyInput(hex, mainnet)
        expect(addressFromPublicKey(pair.publicKey, 'p2wpkh', mainnet)).toBe(CORE_ADDRESS)
    })

    it('still accepts a WIF key for the same private key material', () => {
        const wif = ECPair.fromPrivateKey(Buffer.from(coreNode.privateKey!), {
            network: mainnet.params,
            compressed: true,
        }).toWIF()
        const pair = parsePrivateKeyInput(wif, mainnet)
        expect(addressFromPublicKey(pair.publicKey, 'p2wpkh', mainnet)).toBe(CORE_ADDRESS)
    })

    it('rejects a 0x key that is not exactly 32 bytes', () => {
        expect(() => parsePrivateKeyInput('0x1234', mainnet)).toThrow()
    })

    it('rejects garbage input', () => {
        expect(() => parsePrivateKeyInput('not a key', mainnet)).toThrow()
        expect(() => parsePrivateKeyInput('', mainnet)).toThrow()
    })
})
