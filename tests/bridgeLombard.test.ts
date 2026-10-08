/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * The Avalanche Bridge for Bitcoin (Lombard) as a bridge provider: which
 * pairs it takes, its minimums, the C-Chain "prepare" step that creates the
 * deposit address before the Bitcoin wallet pays it — authorized separately,
 * since one session can only hold one wallet's authorization.
 */
const lombard = {
    depositAddressFor: jest.fn(async () => ({ address: 'bc1qdeposit', created: true })),
    redeemConfig: jest.fn(async () => ({ router: '0xrouter', commissionSats: 10_000, minSats: 3_300, enabled: true })),
    redeemToBitcoin: jest.fn(async () => ({ txHash: '0xredeem', approveTxHash: '0xapprove' })),
    depositStatus: jest.fn(),
    redeemStatus: jest.fn(),
}
jest.mock('@/bitcoinSwap/lombard', () => ({ ...jest.requireActual('@/bitcoinSwap/lombard'), ...lombard }))
jest.mock('@/bitcoin/esplora', () => ({ ...jest.requireActual('@/bitcoin/esplora'), getFeeEstimates: async () => ({ '3': 5 }) }))
const auth: string[] = []
jest.mock('@/js/security/authorize', () => ({
    authorizeBatch: async (w: any, reason: string, fn: () => unknown) => {
        auth.push(`${w.name}: ${reason}`)
        return fn()
    },
}))
const evmSigner = { address: '0xB57904252BCE32F98CD7c9420496c76F5b2b485F', authSubject: { name: 'c-chain' }, network: { evmChainId: 43114 } }
const btcWallet = { name: 'bitcoin', isReadonly: false, network: { id: 'mainnet' }, refresh: jest.fn(async () => {}), send: jest.fn(async () => 'btctxid') }
jest.mock('@/bridge/signers', () => ({
    walletSigners: { evm: () => evmSigner, solana: () => null, bitcoin: () => btcWallet },
    canSignOn: () => true,
    ownAddressOn: () => '',
}))
jest.mock('@/stores', () => ({ useOfflineSigningStore: () => ({ isActive: false }) }))

import { lombardProvider } from '@/bridge/lombard/provider'
import { providersFor } from '@/bridge/registry'
import { runTransfer } from '@/bridge/run'
import { getBridgeChain } from '@/bridge/chains'
import { nativeAsset } from '@/bridge/assets'
import { BTCB } from '@/bitcoinSwap/lombard'

const chain = (id: string) => getBridgeChain(id)!
const ME = evmSigner.address
const BTCB_ASSET = { chainId: 'evm:43114', address: BTCB, symbol: 'BTC.b', decimals: 8 }

beforeEach(() => {
    auth.length = 0
    jest.clearAllMocks()
})

it('takes BTC ↔ BTC.b in place of THORChain, nothing else', () => {
    expect(providersFor(nativeAsset(chain('bitcoin:mainnet')), chain('evm:43114')).map((p) => p.id)).toEqual(['avalanche-bridge-btc'])
    expect(providersFor(BTCB_ASSET, chain('bitcoin:mainnet')).map((p) => p.id)).toEqual(['avalanche-bridge-btc'])
    expect(lombardProvider.supports(nativeAsset(chain('evm:43114')), chain('bitcoin:mainnet'))).toBe(false)
})

it('quotes 1:1 for deposits and minus the commission for redeems, with Lombard’s minimums', async () => {
    const dep = await lombardProvider.quote({ from: nativeAsset(chain('bitcoin:mainnet')), toChain: chain('evm:43114'), amount: BigInt(21_000), sender: 'bc1qme', recipient: ME })
    expect(dep.receive).toMatchObject({ amount: BigInt(21_000), asset: { symbol: 'BTC.b' } })
    await expect(lombardProvider.quote({ from: nativeAsset(chain('bitcoin:mainnet')), toChain: chain('evm:43114'), amount: BigInt(10_000), sender: 'bc1qme', recipient: ME })).rejects.toThrow(/at least 0.0002 BTC/)
    const red = await lombardProvider.quote({ from: BTCB_ASSET, toChain: chain('bitcoin:mainnet'), amount: BigInt(610_136), sender: ME, recipient: 'bc1qme' })
    expect(red.receive.amount).toBe(BigInt(600_136))
    await expect(lombardProvider.quote({ from: BTCB_ASSET, toChain: chain('bitcoin:mainnet'), amount: BigInt(13_000), sender: ME, recipient: 'bc1qme' })).rejects.toThrow(/smallest redeem/)
})

it('a deposit authorizes the C-Chain wallet for the address, then the Bitcoin wallet for the payment', async () => {
    const q = await lombardProvider.quote({ from: nativeAsset(chain('bitcoin:mainnet')), toChain: chain('evm:43114'), amount: BigInt(21_000), sender: 'bc1qme', recipient: ME })
    const t = await runTransfer(q)
    expect(auth).toEqual(['c-chain: Create your BTC.b deposit address (Lombard)', 'bitcoin: Bridge BTC from Bitcoin to Avalanche C-Chain'])
    expect(btcWallet.send).toHaveBeenCalledWith({ to: 'bc1qdeposit', amountSats: 21_000, feeRate: 5 })
    expect(t).toMatchObject({ sourceTxHash: 'btctxid', data: { direction: 'deposit', depositAddress: 'bc1qdeposit', evmAddress: ME } })
})

it('refuses a deposit to someone else’s C-Chain address (BTC.b is minted to the signing account)', async () => {
    const q = await lombardProvider.quote({ from: nativeAsset(chain('bitcoin:mainnet')), toChain: chain('evm:43114'), amount: BigInt(21_000), sender: 'bc1qme', recipient: '0x0000000000000000000000000000000000000001' })
    await expect(runTransfer(q)).rejects.toThrow(/set the recipient to your own C-Chain address/)
    expect(btcWallet.send).not.toHaveBeenCalled()
})

it('a redeem needs only the C-Chain wallet — no prepare step', async () => {
    const q = await lombardProvider.quote({ from: BTCB_ASSET, toChain: chain('bitcoin:mainnet'), amount: BigInt(610_136), sender: ME, recipient: 'bc1qme' })
    const t = await runTransfer(q)
    expect(auth).toEqual(['c-chain: Bridge BTC.b from Avalanche C-Chain to Bitcoin'])
    expect(lombard.redeemToBitcoin.mock.calls[0].slice(1, 3)).toEqual([BigInt(610_136), 'bc1qme'])
    expect(t.sourceTxHash).toBe('0xredeem')
})

it('tracks deposits by Lombard’s claim and redeems by its completion', async () => {
    lombard.depositStatus.mockResolvedValueOnce({ found: true, notarization: 'NOTARIZATION_STATUS_PENDING' }).mockResolvedValueOnce({ found: true, claimTx: '0xmint' })
    const base: any = { status: 'in_transit', recipient: ME, sourceTxHash: 'btctxid', data: { direction: 'deposit', evmAddress: ME } }
    expect(await lombardProvider.refresh(base)).toMatchObject({ status: 'in_transit', statusDetail: 'Lombard is notarizing the deposit.' })
    expect(await lombardProvider.refresh(base)).toMatchObject({ status: 'completed', destTxHash: '0xmint' })
    lombard.redeemStatus.mockResolvedValueOnce({ found: true, completed: true, toAddress: 'bc1qme' })
    expect(await lombardProvider.refresh(Object.assign({}, base, { sourceTxHash: '0xredeem', data: { direction: 'redeem', evmAddress: ME } }))).toMatchObject({ status: 'completed' })
})
