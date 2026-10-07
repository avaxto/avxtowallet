/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * The official Avalanche Bridge, as a `BridgeProvider` — used for WETH.e on
 * Avalanche back to Ethereum in place of Wormhole (see `supersedes`).
 *
 * How it works, checked against the live bridge rather than assumed:
 *  - Sending: one transaction on Avalanche, `unwrap(amount, 0)` on the
 *    WETH.e contract itself (0 = Ethereum). It burns the WETH.e; the bridge's
 *    wardens then pay out on Ethereum. Recent real transfers on chain use
 *    exactly this call.
 *  - Paying out: the bridge's Ethereum wallet sends WETH (the ERC-20, not
 *    native ETH) to the SAME address that sent the unwrap, minus a fee. So
 *    the recipient is always the sender's own address, and the result is WETH
 *    — the page offers a separate, optional unwrap to ETH afterwards.
 *  - Fee and status: the bridge's own bridge_settings.json (the same file the
 *    official web app loads), fetched from its mirrors; the fee estimate is
 *    its `unwrapFeeApproximation` (currently a $20 minimum).
 *
 * Tracking: the payout is found as a WETH transfer from the bridge's Ethereum
 * wallet to the recipient, through Ethereum's Blockscout API.
 */
import axios from 'axios'
import Web3 from 'web3'

import { BN } from '@/avalanche'
import { isOfflineTxId } from '@/stores/offlineSigning'
import { getBridgeChain } from '../chains'
import {
    newTransfer,
    type BridgeAsset,
    type BridgeFee,
    type BridgeProvider,
    type BridgeQuote,
    type BridgeQuoteRequest,
    type BridgeTransfer,
} from '../types'

export const AVALANCHE_BRIDGE_ID = 'avalanche-bridge'
const ROUTE = 'avalanche-bridge:offboard'

export const WETH_E = '0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB'
export const WETH_ETHEREUM = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
/** `unwrap`'s chain argument for Ethereum. */
const ETHEREUM_BRIDGE_CHAIN = 0

/** Mirrors of the bridge's settings, as the official web app loads them. */
export const SETTINGS_URLS = [
    'https://avawarden-prod.s3.amazonaws.com/bridge_settings.json',
    'https://assets.warden-mainnet.avalanche.protofire.io/bridge_settings.json',
    'https://warden-avax-storage.s3.amazonaws.com/bridge_settings.json',
    'https://blob-storage-mainnet.warden-avascan.info/bridge_settings.json',
]
export const BLOCKSCOUT_ETH = 'https://eth.blockscout.com/api/v2'
const TIMEOUT_MS = 15_000
const SETTINGS_TTL_MS = 60_000
const UNWRAP_GAS = 100_000
const WETH_WITHDRAW_GAS = 60_000
/** Offboarding is typically processed within minutes of the Avalanche confirmation. */
const ETA_SECONDS = 15 * 60

const ABI = {
    unwrap: {
        name: 'unwrap',
        type: 'function',
        inputs: [
            { name: 'amount', type: 'uint256' },
            { name: 'chainId', type: 'uint256' },
        ],
    },
    withdraw: { name: 'withdraw', type: 'function', inputs: [{ name: 'wad', type: 'uint256' }] },
}

export interface BridgeSettingsView {
    operational: boolean
    blocked: (address: string) => boolean
    /** The bridge's wallet on Ethereum, which pays out. */
    ethereumWallet: string
    feeFor(amount: bigint): bigint
}

let settingsCache: { at: number; view: BridgeSettingsView } | null = null

/** The parts of bridge_settings.json this provider needs. Throws if the bridge is not accepting offboarding. */
export function parseSettings(raw: any): BridgeSettingsView {
    const critical = raw?.critical
    const asset = critical?.assets?.WETH
    const fee = raw?.nonCritical?.unwrapFeeApproximation?.WETH
    if (!critical || !asset || !fee) throw new Error('The Avalanche Bridge settings are incomplete.')
    if (String(asset.wrappedContractAddress).toLowerCase() !== WETH_E.toLowerCase()) {
        throw new Error('The Avalanche Bridge no longer lists WETH.e at the expected address.')
    }
    const blocklist = new Set<string>((critical.addressBlocklist ?? []).map((a: string) => String(a).toLowerCase()))
    const min = BigInt(fee.minimumFeeAmount)
    const max = BigInt(fee.maximumFeeAmount)
    const pct = BigInt(fee.feePercentage)
    const pctDecimals = BigInt(fee.feePercentageDecimals)
    return {
        operational: critical.operationMode === 'normal' && !critical.disableFrontend,
        blocked: (a) => blocklist.has(a.toLowerCase()),
        ethereumWallet: String(critical.walletAddresses?.ethereum ?? ''),
        // `feePercentage` is a percent with `feePercentageDecimals` decimals (1 / 1 = 0.1%), clamped to [min, max].
        feeFor: (amount) => {
            const proportional = (amount * pct) / (BigInt(100) * BigInt(10) ** pctDecimals)
            return proportional < min ? min : proportional > max ? max : proportional
        },
    }
}

export async function loadSettings(): Promise<BridgeSettingsView> {
    if (settingsCache && Date.now() - settingsCache.at < SETTINGS_TTL_MS) return settingsCache.view
    let lastError: unknown
    for (const url of SETTINGS_URLS) {
        try {
            const { data } = await axios.get(url, { timeout: TIMEOUT_MS })
            const view = parseSettings(data)
            settingsCache = { at: Date.now(), view }
            return view
        } catch (e) {
            lastError = e
        }
    }
    throw lastError instanceof Error ? lastError : new Error('The Avalanche Bridge settings could not be loaded.')
}

/** Test seam. */
export function __resetAvalancheBridgeSettings(): void {
    settingsCache = null
}

const isWethE = (a: BridgeAsset) => a.chainId === 'evm:43114' && a.address.toLowerCase() === WETH_E.toLowerCase()

const WETH_ON_ETHEREUM: BridgeAsset = { chainId: 'evm:1', address: WETH_ETHEREUM, symbol: 'WETH', decimals: 18, name: 'Wrapped Ether' }

export const avalancheBridgeProvider: BridgeProvider = {
    id: AVALANCHE_BRIDGE_ID,
    name: 'Avalanche Bridge',
    supersedes: ['wormhole'],

    supports(from, toChain) {
        return isWethE(from) && toChain.id === 'evm:1'
    },

    async quote(req: BridgeQuoteRequest): Promise<BridgeQuote> {
        if (!isWethE(req.from) || req.toChain.id !== 'evm:1') throw new Error('The Avalanche Bridge route here is WETH.e from Avalanche to Ethereum.')
        const settings = await loadSettings()
        if (!settings.operational) throw new Error('The Avalanche Bridge is paused right now. Try again later.')
        if (req.sender && settings.blocked(req.sender)) throw new Error('The Avalanche Bridge does not accept transfers from this address.')
        if (req.sender && req.recipient.toLowerCase() !== req.sender.toLowerCase()) {
            throw new Error(
                'The Avalanche Bridge always pays out to the address that sends — set the recipient to your own address.'
            )
        }
        const fee = settings.feeFor(req.amount)
        const out = req.amount - fee
        if (out <= BigInt(0)) {
            throw Object.assign(new Error(`The Avalanche Bridge fee is about ${Web3.utils.fromWei(fee.toString())} ETH — send more than that.`), {
                code: 'below_min',
            })
        }
        const fees: BridgeFee[] = [{ label: 'Avalanche Bridge fee (estimate)', amount: fee, symbol: 'WETH', decimals: 18, paidAs: 'deducted' }]
        return {
            providerId: AVALANCHE_BRIDGE_ID,
            routeId: ROUTE,
            routeName: 'Avalanche Bridge',
            request: req,
            receive: { asset: WETH_ON_ETHEREUM, amount: out, kind: 'canonical' },
            fees,
            etaSeconds: ETA_SECONDS,
            needsClaim: false,
            warnings: [
                'Arrives as WETH on Ethereum, at your own address. Unwrapping it to ETH is a separate, optional step on Ethereum (needs a little ETH for gas).',
                'The fee is the bridge’s estimate; the exact fee is set when the bridge processes the transfer.',
            ],
            data: { ethereumWallet: settings.ethereumWallet },
        }
    },

    async execute(quote, signers, onProgress) {
        const src = getBridgeChain('evm:43114')
        const signer = src ? signers.evm(src) : null
        if (!signer) throw new Error('Bridging from Avalanche needs your wallet on Avalanche C-Chain. Switch to it first.')
        await signer.assertOnChain()
        const step = 'Send WETH.e to the Avalanche Bridge'
        onProgress?.(step, 'running')
        const req = {
            to: WETH_E,
            data: new Web3().eth.abi.encodeFunctionCall(ABI.unwrap as any, [quote.request.amount.toString(), String(ETHEREUM_BRIDGE_CHAIN)]),
            label: step,
        }
        const gasLimit = await signer.estimateGas(req, UNWRAP_GAS)
        const hash = await signer.send(Object.assign({}, req, { gasLimit }))
        if (isOfflineTxId(hash)) throw new Error('Bridging needs the transaction broadcast. Turn off offline signing to bridge.')
        const receipt = await signer.waitForReceipt(hash)
        if (!receipt.status) throw new Error('The Avalanche Bridge transaction failed on chain.')
        onProgress?.(step, 'done')
        const data = quote.data as { ethereumWallet: string }
        return newTransfer(quote, receipt.txHash, { ethereumWallet: data.ethereumWallet, sentAt: Date.now() })
    },

    async refresh(transfer: BridgeTransfer): Promise<BridgeTransfer> {
        const updated = Object.assign({}, transfer, { updatedAt: Date.now() })
        if (transfer.status === 'completed') return updated
        const wallet = String(transfer.data.ethereumWallet ?? '').toLowerCase()
        const { data } = await axios.get(`${BLOCKSCOUT_ETH}/addresses/${transfer.recipient}/token-transfers`, {
            params: { type: 'ERC-20', filter: 'to', token: WETH_ETHEREUM },
            timeout: TIMEOUT_MS,
        })
        const sentAt = Number(transfer.data.sentAt ?? transfer.createdAt)
        const sent = BigInt(transfer.amountIn)
        const payout = (Array.isArray(data?.items) ? data.items : []).find((t: any) => {
            if (String(t?.from?.hash ?? '').toLowerCase() !== wallet) return false
            const value = BigInt(String(t?.total?.value ?? '0'))
            const when = t?.timestamp ? Date.parse(t.timestamp) : sentAt
            // The payout is the amount sent minus a fee, after the send.
            return value > BigInt(0) && value <= sent && value * BigInt(2) >= sent && when >= sentAt - 5 * 60_000
        })
        if (!payout) return Object.assign(updated, { status: 'in_transit' as const, statusDetail: 'Waiting for the bridge to pay out on Ethereum.' })
        return Object.assign(updated, {
            status: 'completed' as const,
            statusDetail: 'Arrived as WETH on Ethereum.',
            destTxHash: String(payout.transaction_hash),
            data: Object.assign({}, transfer.data, { receivedWeth: String(payout.total.value) }),
        })
    },

    followUp: {
        label: 'Unwrap WETH to ETH',
        available: (t) => t.status === 'completed' && !!t.data.receivedWeth && !t.data.unwrapTxHash,
        async run(transfer, signers, onProgress) {
            const eth = getBridgeChain('evm:1')
            const signer = eth ? signers.evm(eth) : null
            if (!signer) throw new Error('Unwrapping needs your wallet on Ethereum. Switch to it first.')
            await signer.assertOnChain()
            const step = 'Unwrap WETH to ETH on Ethereum'
            onProgress?.(step, 'running')
            const amount = String(transfer.data.receivedWeth)
            const req = {
                to: WETH_ETHEREUM,
                data: new Web3().eth.abi.encodeFunctionCall(ABI.withdraw as any, [amount]),
                value: new BN(0),
                label: step,
            }
            const gasLimit = await signer.estimateGas(req, WETH_WITHDRAW_GAS)
            const hash = await signer.send(Object.assign({}, req, { gasLimit }))
            if (isOfflineTxId(hash)) throw new Error('Turn off offline signing to unwrap.')
            const receipt = await signer.waitForReceipt(hash)
            if (!receipt.status) throw new Error('The unwrap failed on chain.')
            onProgress?.(step, 'done')
            return Object.assign({}, transfer, {
                updatedAt: Date.now(),
                statusDetail: 'Arrived as WETH, unwrapped to ETH.',
                data: Object.assign({}, transfer.data, { unwrapTxHash: receipt.txHash }),
            })
        },
    },
}

/** Explorer link for the Avalanche side of a transfer. */
export function avalancheBridgeTrackerUrl(transfer: BridgeTransfer): string {
    return transfer.destTxHash ? `https://etherscan.io/tx/${transfer.destTxHash}` : `https://snowtrace.io/tx/${transfer.sourceTxHash}`
}
