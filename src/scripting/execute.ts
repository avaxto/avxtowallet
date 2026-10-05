/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Executes one approved `Intent` through the wallet's existing signing paths —
 * the same ones the send pages use — so every signature still passes the
 * session-password authorization, the chain guard and the extension / Ledger
 * prompt. Nothing here reaches key material directly.
 *
 * Signing follows each platform's rule: Avalanche only signs while its tab is
 * in front (mainStore.activeWallet), so a spend never happens on a chain the
 * user is not looking at; EVM, Solana and Bitcoin sign from their connected
 * wallet as the bridge does.
 */
import Big from 'big.js'
import Web3 from 'web3'

import { BN } from '@/avalanche'
import { getPlatform } from '@/platforms'
import type { EvmSigner } from '@/evm/signer'
import { explorerTxUrl, getEvmNetworkByChainId } from '@/evm/networkRegistry'
import { useAssetsStore, useMainStore } from '@/stores'
import { useNetworkStore } from '@/stores/network'
import { useOfflineSigningStore, isOfflineTxId } from '@/stores/offlineSigning'
import { SolanaWallet } from '@/platforms/solana/wallet'
import { BitcoinWallet } from '@/platforms/bitcoin/wallet'
import { getSolanaNetworkById, getSolanaTxUrl } from '@/solana/networks'
import { connectionFor } from '@/solana/rpc'
import { getBitcoinNetworkById, getBitcoinTxUrl } from '@/bitcoin/networks'
import { getFeeEstimates } from '@/bitcoin/esplora'
import { avalancheIsTestnet } from './platforms'
import { avalancheCrossChain } from './avalancheCrossChain'
import { buildSplTransfer } from './solanaSpl'
import type { Intent } from './types'

const EVM_TRANSFER_GAS = 21_000
const ERC20_TRANSFER_GAS = 100_000
/** Bitcoin fee target, in blocks (about an hour). */
const BTC_TARGET_BLOCKS = '6'

export interface ExecResult {
    txId: string
    txIds?: string[]
    explorerUrl?: string
}

function evmSignerFor(intent: Intent): EvmSigner | null {
    const platform = intent.platform === 'avalanche' ? 'avalanche' : 'evm'
    return getPlatform(platform)?.getEvmSigner?.() ?? null
}

function solanaWallet(): SolanaWallet | null {
    const w = getPlatform('solana')?.getActiveWallet()
    return w instanceof SolanaWallet ? w : null
}

function bitcoinWallet(): BitcoinWallet | null {
    const w = getPlatform('bitcoin')?.getActiveWallet()
    return w instanceof BitcoinWallet ? w : null
}

/** '' when `intent` can be signed right now, otherwise what the user has to do first. */
export function readiness(intent: Intent): string {
    if (useOfflineSigningStore().isActive) {
        return 'Offline signing is on. Scripts need every transaction broadcast — turn it off to execute.'
    }
    switch (intent.platform) {
        case 'avalanche': {
            if (!useMainStore().activeWallet) return 'Open the Avalanche tab to execute Avalanche steps — it only signs while in front.'
            if (avalancheIsTestnet() !== intent.isTestnet) return 'The Avalanche network changed since this was planned. Plan again.'
            if (intent.kind === 'send' && intent.chain === 'C' && !evmSignerFor(intent)) return 'No C-Chain signer is available for this wallet.'
            return ''
        }
        case 'evm': {
            const s = evmSignerFor(intent)
            if (!s) return 'Connect an EVM wallet that can sign.'
            if (s.network.evmChainId !== intent.evmChainId) {
                return `The EVM wallet is on ${s.network.name}; this step is for ${intent.chainLabel}. Switch networks first.`
            }
            return ''
        }
        case 'solana': {
            const w = solanaWallet()
            if (!w) return 'Connect a Solana wallet.'
            if (w.isReadonly) return 'This Solana wallet is watch-only.'
            if (w.network.id !== intent.chain) return `The Solana wallet is on ${w.network.name}; this step is for ${intent.chainLabel}.`
            return ''
        }
        case 'bitcoin': {
            const w = bitcoinWallet()
            if (!w) return 'Connect a Bitcoin wallet.'
            if (w.isReadonly) return 'This Bitcoin wallet is watch-only.'
            if (w.network.id !== intent.chain) return `The Bitcoin wallet is on ${w.network.name}; this step is for ${intent.chainLabel}.`
            return ''
        }
    }
    return 'Unknown platform.'
}

/** The wallet whose authorization covers `intent` (see js/security/authorize). */
export function authSubjectFor(intent: Intent): unknown {
    if (intent.platform === 'avalanche') {
        if (intent.kind === 'send' && intent.chain === 'C') return evmSignerFor(intent)?.authSubject ?? null
        return useMainStore().activeWallet
    }
    if (intent.platform === 'evm') return evmSignerFor(intent)?.authSubject ?? null
    if (intent.platform === 'solana') return solanaWallet()
    return bitcoinWallet()
}

/** Signs and broadcasts `intent`. Call inside an authorization scope for `authSubjectFor(intent)`. */
export async function executeIntent(intent: Intent, onStep?: (label: string) => void): Promise<ExecResult> {
    const notReady = readiness(intent)
    if (notReady) throw new Error(notReady)
    const amount = BigInt(intent.amountBase)

    if (intent.platform === 'avalanche' && intent.kind === 'crossChain') {
        const wallet = useMainStore().activeWallet as any
        const r = await avalancheCrossChain(wallet, intent.chain as any, intent.toChain as any, new BN(intent.amountBase), (step, state) => {
            if (state === 'running') onStep?.(step === 'export' ? `Export from ${intent.chain}-Chain` : `Import to ${intent.toChain}-Chain`)
        })
        try {
            await useAssetsStore().updateUTXOs()
        } catch {
            /* balances refresh on their own */
        }
        return { txId: r.exportTxId, txIds: [r.exportTxId, r.importTxId], explorerUrl: avalancheTxUrl(r.importTxId) }
    }

    if (intent.platform === 'avalanche' && intent.chain === 'X') {
        const assets = useAssetsStore()
        const ava = assets.AssetAVA
        if (!ava) throw new Error('AVAX balances are not loaded yet.')
        const txId: string = await useMainStore().issueBatchTx({
            toAddress: intent.to,
            // Two Buffer typings meet here (Node's and the polyfill's); the value is the same.
            memo: Buffer.from('') as any,
            orders: [{ uuid: `script-${intent.index}`, asset: ava, amount: new BN(intent.amountBase) }] as any,
        })
        if (!txId || txId === 'error') throw new Error('The X-Chain send failed.')
        return { txId, explorerUrl: avalancheTxUrl(txId) }
    }

    if (intent.platform === 'avalanche' || intent.platform === 'evm') {
        const signer = evmSignerFor(intent)
        if (!signer) throw new Error('No EVM signer.')
        await signer.assertOnChain()
        const label = intent.summary
        const req =
            intent.asset.id === 'native'
                ? { to: intent.to, value: new BN(amount.toString()), label }
                : {
                      to: intent.asset.id,
                      data: new Web3().eth.abi.encodeFunctionCall(
                          {
                              name: 'transfer',
                              type: 'function',
                              inputs: [
                                  { name: 'to', type: 'address' },
                                  { name: 'amount', type: 'uint256' },
                              ],
                          },
                          [intent.to, amount.toString()]
                      ),
                      label,
                  }
        const gasLimit = await signer.estimateGas(req, intent.asset.id === 'native' ? EVM_TRANSFER_GAS : ERC20_TRANSFER_GAS)
        const hash = await signer.send(Object.assign({}, req, { gasLimit }))
        if (isOfflineTxId(hash)) throw new Error('The transaction was captured, not sent — turn off offline signing.')
        const receipt = await signer.waitForReceipt(hash)
        if (!receipt.status) throw new Error(`The transaction ${receipt.txHash} failed on chain.`)
        const network = getEvmNetworkByChainId(intent.evmChainId ?? -1)
        return { txId: receipt.txHash, explorerUrl: network ? explorerTxUrl(network, receipt.txHash) : undefined }
    }

    if (intent.platform === 'solana') {
        const w = solanaWallet()
        if (!w) throw new Error('No Solana wallet.')
        const network = getSolanaNetworkById(intent.chain)
        let sig: string
        if (intent.asset.id === 'native') {
            sig = await w.sendSol(intent.to, new Big(intent.amount))
        } else {
            if (!network) throw new Error('Unknown Solana network.')
            const tx = await buildSplTransfer(connectionFor(network), w.address, intent.to, intent.asset.id, amount, intent.asset.decimals)
            sig = await w.sendTransaction(tx)
        }
        return { txId: sig, explorerUrl: network ? getSolanaTxUrl(sig, network) : undefined }
    }

    const w = bitcoinWallet()
    if (!w) throw new Error('No Bitcoin wallet.')
    const network = getBitcoinNetworkById(intent.chain)
    if (!network) throw new Error('Unknown Bitcoin network.')
    // Spendable outputs come from the latest scan.
    await w.refresh()
    const estimates = await getFeeEstimates(network)
    const feeRate = Math.max(1, Math.ceil(estimates[BTC_TARGET_BLOCKS] ?? estimates['3'] ?? estimates['1'] ?? 1))
    const txid = await w.send({ to: intent.to, amountSats: Number(amount), feeRate })
    return { txId: txid, explorerUrl: getBitcoinTxUrl(txid, network) }
}

function avalancheTxUrl(txId: string): string | undefined {
    const explorer = useNetworkStore().selectedNetwork?.explorerSiteUrl
    return explorer ? `${explorer}/tx/${txId}` : undefined
}
