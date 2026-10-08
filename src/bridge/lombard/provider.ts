/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * The Avalanche Bridge for Bitcoin — BTC on the Bitcoin network ↔ BTC.b on
 * Avalanche C-Chain, run by Lombard (what Core uses today) — as a
 * `BridgeProvider`. It replaces THORChain on those two pairs, per the rule
 * that Bitcoin always goes through the Avalanche Bridge. The mechanics live
 * in src/bitcoinSwap/lombard.ts; see there for how they were verified.
 *
 *  - Bitcoin → BTC.b: `prepare` gets the C-Chain account's deposit address
 *    (one message signature by that account, the first time), then the
 *    Bitcoin wallet pays it. BTC.b arrives 1:1 at that same C-Chain account,
 *    so the recipient must be the user's own C-Chain address.
 *  - BTC.b → Bitcoin: approve + `redeemForBtc` to any Bitcoin address, minus
 *    Lombard's commission.
 */
import { getBitcoinNetworkById } from '@/bitcoin/networks'
import { getFeeEstimates } from '@/bitcoin/esplora'
import { getBridgeChain } from '../chains'
import { NATIVE, newTransfer, type BridgeAsset, type BridgeProvider, type BridgeQuote, type BridgeTransfer } from '../types'
import {
    BTCB,
    BTCB_DECIMALS,
    MIN_DEPOSIT_SATS,
    depositAddressFor,
    depositStatus,
    redeemConfig,
    redeemStatus,
    redeemToBitcoin,
} from '@/bitcoinSwap/lombard'
import { web3For } from '@/evm/providers'
import { getEvmNetworkByChainId } from '@/evm/networkRegistry'

export const LOMBARD_ID = 'avalanche-bridge-btc'
const BTCB_ASSET: BridgeAsset = { chainId: 'evm:43114', address: BTCB, symbol: 'BTC.b', decimals: BTCB_DECIMALS, name: 'Bitcoin (Avalanche Bridge)' }
const BTC_ASSET: BridgeAsset = { chainId: 'bitcoin:mainnet', address: NATIVE, symbol: 'BTC', decimals: 8, name: 'Bitcoin' }
const DEPOSIT_ETA = 60 * 60
const REDEEM_ETA = 3 * 60 * 60

const isDeposit = (from: BridgeAsset, toId: string) => from.chainId === 'bitcoin:mainnet' && from.address === NATIVE && toId === 'evm:43114'
const isRedeem = (from: BridgeAsset, toId: string) => from.chainId === 'evm:43114' && from.address.toLowerCase() === BTCB.toLowerCase() && toId === 'bitcoin:mainnet'

export const lombardProvider: BridgeProvider = {
    id: LOMBARD_ID,
    name: 'Avalanche Bridge (Bitcoin)',
    supersedes: ['thorchain'],

    supports(from, toChain) {
        return isDeposit(from, toChain.id) || isRedeem(from, toChain.id)
    },

    async quote(req): Promise<BridgeQuote> {
        if (isDeposit(req.from, req.toChain.id)) {
            if (req.amount < BigInt(MIN_DEPOSIT_SATS)) throw new Error(`The Avalanche Bridge for Bitcoin needs at least ${MIN_DEPOSIT_SATS / 1e8} BTC.`)
            return {
                providerId: LOMBARD_ID,
                routeId: `${LOMBARD_ID}:deposit`,
                routeName: 'Avalanche Bridge (Bitcoin) — Lombard',
                request: req,
                receive: { asset: BTCB_ASSET, amount: req.amount, kind: 'wrapped' },
                fees: [],
                etaSeconds: DEPOSIT_ETA,
                needsClaim: false,
                warnings: [
                    'Arrives as BTC.b, 1:1, at your own C-Chain address — usually about an hour after your Bitcoin payment confirms. Your Bitcoin network fee is paid on top.',
                    'The first time, your C-Chain wallet signs one message so Lombard can issue your personal deposit address.',
                ],
                data: {},
            }
        }
        if (isRedeem(req.from, req.toChain.id)) {
            const network = getEvmNetworkByChainId(43114)
            const cfg = network ? await redeemConfig(web3For(network)) : null
            if (!cfg) throw new Error('Avalanche C-Chain is not configured.')
            if (!cfg.enabled) throw new Error('Lombard has paused BTC.b redemptions right now.')
            const min = BigInt(cfg.commissionSats + cfg.minSats)
            if (req.amount < min) throw new Error(`The smallest redeem is ${Number(min) / 1e8} BTC.b (it includes Lombard's ${cfg.commissionSats / 1e8} BTC fee).`)
            return {
                providerId: LOMBARD_ID,
                routeId: `${LOMBARD_ID}:redeem`,
                routeName: 'Avalanche Bridge (Bitcoin) — Lombard',
                request: req,
                receive: { asset: BTC_ASSET, amount: req.amount - BigInt(cfg.commissionSats), kind: 'native' },
                fees: [{ label: 'Lombard fee', amount: BigInt(cfg.commissionSats), symbol: 'BTC', decimals: 8, paidAs: 'deducted' }],
                etaSeconds: REDEEM_ETA,
                needsClaim: false,
                warnings: ['Native BTC on the Bitcoin network, usually within a few hours.'],
                data: {},
            }
        }
        throw new Error('The Avalanche Bridge for Bitcoin carries BTC ↔ BTC.b only.')
    },

    prepare: {
        reason: 'Create your BTC.b deposit address (Lombard)',
        needed: (q) => isDeposit(q.request.from, q.request.toChain.id),
        chain: () => getBridgeChain('evm:43114')!,
        async run(q, signers) {
            if (!isDeposit(q.request.from, q.request.toChain.id)) return q
            const c = getBridgeChain('evm:43114')
            const signer = c ? signers.evm(c) : null
            if (!signer) throw new Error('A Bitcoin deposit needs your C-Chain wallet too: open the Avalanche tab or point the EVM wallet at C-Chain.')
            if (signer.address.toLowerCase() !== q.request.recipient.toLowerCase()) {
                throw new Error('BTC.b is minted to the C-Chain account that sets up the deposit — set the recipient to your own C-Chain address.')
            }
            const { address } = await depositAddressFor(signer)
            return Object.assign({}, q, { data: { depositAddress: address } })
        },
    },

    async execute(quote, signers, onProgress) {
        if (isDeposit(quote.request.from, quote.request.toChain.id)) {
            const depositAddress = (quote.data as { depositAddress?: string }).depositAddress
            if (!depositAddress) throw new Error('No deposit address — the preparation step did not run.')
            const src = getBridgeChain('bitcoin:mainnet')
            const wallet = src ? signers.bitcoin(src) : null
            if (!wallet || wallet.isReadonly) throw new Error('Connect a Bitcoin wallet that can sign.')
            const step = `Send BTC to your deposit address ${depositAddress}`
            onProgress?.(step, 'running')
            await wallet.refresh()
            const network = getBitcoinNetworkById('mainnet')!
            const est = await getFeeEstimates(network)
            const feeRate = Math.max(1, Math.ceil(est['3'] ?? est['6'] ?? 1))
            const txid = await wallet.send({ to: depositAddress, amountSats: Number(quote.request.amount), feeRate })
            onProgress?.(step, 'done')
            return newTransfer(quote, txid, { direction: 'deposit', depositAddress, evmAddress: quote.request.recipient })
        }
        const c = getBridgeChain('evm:43114')
        const signer = c ? signers.evm(c) : null
        if (!signer) throw new Error('Redeeming BTC.b needs your C-Chain wallet.')
        const step = 'Redeem BTC.b for BTC'
        onProgress?.(step, 'running')
        const res = await redeemToBitcoin(signer, quote.request.amount, quote.request.recipient, getBitcoinNetworkById('mainnet')!)
        onProgress?.(step, 'done')
        return newTransfer(quote, res.txHash, { direction: 'redeem', evmAddress: signer.address })
    },

    async refresh(t: BridgeTransfer): Promise<BridgeTransfer> {
        const updated = Object.assign({}, t, { updatedAt: Date.now() })
        if (t.status === 'completed') return updated
        if (t.data.direction === 'deposit') {
            const s = await depositStatus(String(t.data.evmAddress), t.sourceTxHash)
            if (s.claimTx) return Object.assign(updated, { status: 'completed' as const, destTxHash: s.claimTx, statusDetail: 'BTC.b arrived on Avalanche.' })
            return Object.assign(updated, {
                status: 'in_transit' as const,
                statusDetail: s.found ? 'Lombard is notarizing the deposit.' : 'Waiting for Lombard to see the Bitcoin payment.',
            })
        }
        const s = await redeemStatus(String(t.data.evmAddress), t.sourceTxHash)
        if (s.completed) return Object.assign(updated, { status: 'completed' as const, statusDetail: `Paid out to ${s.toAddress ?? t.recipient}.` })
        return Object.assign(updated, { status: 'in_transit' as const, statusDetail: s.found ? 'Lombard is paying out on Bitcoin.' : 'Waiting for Lombard to see the redeem.' })
    },
}

export function lombardTrackerUrl(t: BridgeTransfer): string {
    return t.data.direction === 'deposit' ? `https://mempool.space/tx/${t.sourceTxHash}` : `https://snowtrace.io/tx/${t.sourceTxHash}`
}
