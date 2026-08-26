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
    detectAddressType,
    isValidBitcoinAddress,
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
