/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Bridge EVM identity: while an Avalanche wallet is signed in, its C-Chain
 * address is the only EVM address the bridge reads from or signs with — the
 * one the portfolio shows — even when the EVM tab holds another account.
 */
const main: { avalancheWallet: any } = { avalancheWallet: null }
const evmTab: { wallet: any; signer: any } = { wallet: null, signer: null }
let active: any = null

jest.mock('@/stores', () => ({ useMainStore: () => main }))
jest.mock('@/platforms', () => ({
    getPlatform: (id: string) =>
        id === 'evm' ? { getActiveWallet: () => evmTab.wallet, getEvmSigner: () => evmTab.signer } : undefined,
}))
jest.mock('@/platforms/evmSigner', () => ({ activeEvmSigner: () => active }))
jest.mock('@/platforms/solana/wallet', () => ({ SolanaWallet: class {} }))
jest.mock('@/platforms/bitcoin/wallet', () => ({ BitcoinWallet: class {} }))

import { canSignOn, ownAddressOn, walletSigners } from '@/bridge/signers'

const OWN = '0x5e379D6A276262C293c9C632D0C72ca9C90A9635'
const OTHER = '0x4887C61Ee00A4df4191533F3E7Be62bd00Ea2537'
const cchain: any = { id: 'evm:43114', kind: 'evm', evmChainId: 43114 }
const eth: any = { id: 'evm:1', kind: 'evm', evmChainId: 1 }
const signer = (address: string, evmChainId: number) => ({ address, network: { evmChainId } })

beforeEach(() => {
    main.avalancheWallet = null
    evmTab.wallet = null
    evmTab.signer = null
    active = null
})

describe('bridge EVM identity', () => {
    it("uses the Avalanche wallet's C-Chain address over another EVM tab account", () => {
        main.avalancheWallet = { ethAddress: OWN.slice(2) }
        evmTab.wallet = { getPrimaryAddress: () => OTHER }
        expect(ownAddressOn(cchain)).toBe(OWN)
        expect(ownAddressOn(eth)).toBe(OWN)
    })

    it('never signs with an account other than the Avalanche wallet', () => {
        main.avalancheWallet = { ethAddress: OWN.slice(2) }
        evmTab.signer = signer(OTHER, 1)
        expect(walletSigners.evm(eth)).toBeNull()
        expect(canSignOn(eth)).toBe(false)

        evmTab.signer = signer(OWN.toLowerCase(), 1)
        expect(walletSigners.evm(eth)).toBe(evmTab.signer)
        active = signer(OWN, 43114)
        expect(walletSigners.evm(cchain)).toBe(active)
    })

    it('falls back to the EVM tab when no Avalanche wallet is signed in', () => {
        evmTab.wallet = { getPrimaryAddress: () => OTHER }
        evmTab.signer = signer(OTHER, 1)
        expect(ownAddressOn(eth)).toBe(OTHER)
        expect(walletSigners.evm(eth)).toBe(evmTab.signer)
    })
})
