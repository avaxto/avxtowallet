/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * The official Avalanche Bridge, as a `BridgeProvider`: the bridge's Ethereum
 * tokens between Ethereum and Avalanche, in both directions. Wherever it
 * serves a pair it is used in place of Wormhole and THORChain (`supersedes`).
 *
 * How it works, checked against the live bridge and real transfers on chain
 * rather than assumed:
 *  - Ethereum → Avalanche ("onboarding"): an ordinary ERC-20 `transfer` of the
 *    token to the bridge's Ethereum wallet. The bridge mints the token's ".e"
 *    version to the SAME address on Avalanche, minus a fee (seen on chain: 1.0
 *    WETH in, 0.99883 WETH.e minted to the sender). Native ETH is wrapped to
 *    WETH first, so ETH takes two transactions.
 *  - Avalanche → Ethereum ("offboarding"): `unwrap(amount, 0)` on the ".e"
 *    token (0 = Ethereum). It burns the token; the bridge's Ethereum wallet
 *    then sends the original ERC-20 — WETH, not native ETH — to the SAME
 *    address, minus a fee (seen on chain: 83.96 WETH.e in, 83.952 WETH out).
 *  - So the recipient is always the sender's own address.
 *  - Its wallet address, pause state, blocklist, token list and fees all come
 *    from the bridge's own bridge_settings.json (what the official app loads),
 *    fetched from its mirrors. A token whose addresses there no longer match
 *    the table below is refused.
 *
 * The ".e" tokens are the bridge's own: its USDC on Avalanche is USDC.e, not
 * the native USDC Circle issues there — the page and the warnings say so.
 *
 * Not covered here: Bitcoin ↔ BTC.b. That side of the bridge could not be
 * verified from on-chain data, so Bitcoin keeps its other routes for now.
 */
import axios from 'axios'
import Web3 from 'web3'

import { BN } from '@/avalanche'
import { getEvmNetworkByChainId } from '@/evm/networkRegistry'
import { web3For } from '@/evm/providers'
import { isOfflineTxId } from '@/stores/offlineSigning'
import { getBridgeChain } from '../chains'
import {
    NATIVE,
    newTransfer,
    type BridgeAsset,
    type BridgeFee,
    type BridgeProvider,
    type BridgeQuote,
    type BridgeQuoteRequest,
    type BridgeTransfer,
} from '../types'

export const AVALANCHE_BRIDGE_ID = 'avalanche-bridge'
const ROUTE = 'avalanche-bridge'

export interface BridgeToken {
    symbol: string
    name: string
    decimals: number
    /** The original ERC-20 on Ethereum. */
    ethereum: string
    /** The bridge's ".e" token on Avalanche C-Chain. */
    avalanche: string
}

/** The bridge's token list (from its settings; re-checked against the live settings on every quote). */
export const BRIDGE_TOKENS: BridgeToken[] = [
    { symbol: '1INCH', name: '1INCH Token', decimals: 18, ethereum: '0x111111111117dc0aa78b770fa6a738034120c302', avalanche: '0xd501281565bf7789224523144fe5d98e8b28f267' },
    { symbol: 'AAVE', name: 'Aave Token', decimals: 18, ethereum: '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9', avalanche: '0x63a72806098bd3d9520cc43356dd78afe5d386d9' },
    { symbol: 'ALPHA', name: 'AlphaToken', decimals: 18, ethereum: '0xa1faa113cbe53436df28ff0aee54275c13b40975', avalanche: '0x2147efff675e4a4ee1c2f918d181cdbd7a8e208f' },
    { symbol: 'BAT', name: 'Basic Attention Token', decimals: 18, ethereum: '0x0d8775f648430679a709e98d2b0cb6250d2887ef', avalanche: '0x98443b96ea4b0858fdf3219cd13e98c7a4690588' },
    { symbol: 'BUSD', name: 'Binance USD', decimals: 18, ethereum: '0x4fabb145d64652a948d72533023f6e7a623c7c53', avalanche: '0x19860ccb0a68fd4213ab9d8266f7bbf05a8dde98' },
    { symbol: 'COMP', name: 'Compound', decimals: 18, ethereum: '0xc00e94cb662c3520282e6f5717214004a7f26888', avalanche: '0xc3048e19e76cb9a3aa9d77d8c03c29fc906e2437' },
    { symbol: 'CRV', name: 'Curve DAO Token', decimals: 18, ethereum: '0xd533a949740bb3306d119cc777fa900ba034cd52', avalanche: '0x249848beca43ac405b8102ec90dd5f22ca513c06' },
    { symbol: 'DAI', name: 'Dai Stablecoin', decimals: 18, ethereum: '0x6b175474e89094c44da98b954eedeac495271d0f', avalanche: '0xd586e7f844cea2f87f50152665bcbc2c279d8d70' },
    { symbol: 'GRT', name: 'Graph Token', decimals: 18, ethereum: '0xc944e90c64b2c07662a292be6244bdf05cda44a7', avalanche: '0x8a0cac13c7da965a312f08ea4229c37869e85cb9' },
    { symbol: 'INFRA', name: 'Bware', decimals: 18, ethereum: '0x013062189dc3dcc99e9cee714c513033b8d99e3c', avalanche: '0xa4fb4f0ff2431262d236778495145ecbc975c38b' },
    { symbol: 'LINK', name: 'Chainlink Token', decimals: 18, ethereum: '0x514910771af9ca656af840dff83e8264ecf986ca', avalanche: '0x5947bb275c521040051d82396192181b413227a3' },
    { symbol: 'MKR', name: 'Maker', decimals: 18, ethereum: '0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2', avalanche: '0x88128fd4b259552a9a1d457f435a6527aab72d42' },
    { symbol: 'SHIB', name: 'SHIBA INU', decimals: 18, ethereum: '0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce', avalanche: '0x02d980a0d7af3fb7cf7df8cb35d9edbcf355f665' },
    { symbol: 'SNX', name: 'Synthetix Network Token', decimals: 18, ethereum: '0xc011a73ee8576fb46f5e1c5751ca3b9fe0af2a6f', avalanche: '0xbec243c995409e6520d7c41e404da5deba4b209b' },
    { symbol: 'SUSHI', name: 'SushiToken', decimals: 18, ethereum: '0x6b3595068778dd592e39a122f4f5a5cf09c90fe2', avalanche: '0x37b608519f91f70f2eeb0e5ed9af4061722e4f76' },
    { symbol: 'SWAP', name: 'TrustSwap Token', decimals: 18, ethereum: '0xcc4304a31d09258b0029ea7fe63d032f52e44efe', avalanche: '0xc7b5d72c836e718cda8888eaf03707faef675079' },
    { symbol: 'UMA', name: 'UMA Voting Token v1', decimals: 18, ethereum: '0x04fa0d235c4abf4bcf4787af4cf447de572ef828', avalanche: '0x3bd2b1c7ed8d396dbb98ded3aebb41350a5b2339' },
    { symbol: 'UNI', name: 'Uniswap', decimals: 18, ethereum: '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984', avalanche: '0x8ebaf22b6f053dffeaf46f4dd9efa95d89ba8580' },
    { symbol: 'USDC', name: 'USD Coin', decimals: 6, ethereum: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', avalanche: '0xa7d7079b0fead91f3e65f86e8915cb59c1a4c664' },
    { symbol: 'USDT', name: 'Tether USD', decimals: 6, ethereum: '0xdac17f958d2ee523a2206206994597c13d831ec7', avalanche: '0xc7198437980c041c805a1edcba50c1ce5db95118' },
    { symbol: 'WBTC', name: 'Wrapped BTC', decimals: 8, ethereum: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', avalanche: '0x50b7545627a5162f82a992c33b87adc75187b218' },
    { symbol: 'WETH', name: 'Wrapped Ether', decimals: 18, ethereum: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', avalanche: '0x49d5c2bdffac6ce2bfdb6640f4f80f226bc10bab' },
    { symbol: 'WOO', name: 'Wootrade Network', decimals: 18, ethereum: '0x4691937a7508860f876c9c0a2a617e7d9e945d4b', avalanche: '0xabc9547b534519ff73921b1fba6e672b5f58d083' },
    { symbol: 'YFI', name: 'yearn.finance', decimals: 18, ethereum: '0x0bc529c00c6401aef6d220be8c6ea1667f6ad93e', avalanche: '0x9eaac1b23d935365bd7b542fe22ceee2922f52dc' },
    { symbol: 'ZRX', name: 'ZRX', decimals: 18, ethereum: '0xe41d2489571d322189246dafa5ebde1f4699f498', avalanche: '0x596fa47043f99a4e0f122243b841e55375cde0d2' },
]

export const WETH_E = '0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB'
export const WETH_ETHEREUM = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
/** `unwrap`'s chain argument for Ethereum (what real offboarding transfers pass). */
const ETHEREUM_BRIDGE_CHAIN = 0

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
const TRANSFER_GAS = 100_000
const WETH_GAS = 60_000
const OFFBOARD_ETA_SECONDS = 15 * 60
/** Ethereum needs its confirmations (the settings ask for 96 blocks) before the bridge mints. */
const ONBOARD_ETA_SECONDS = 25 * 60
const LOG_CHUNK = 2048
const MAX_LOG_CHUNKS_PER_REFRESH = 20

const fn = (name: string, inputs: { name: string; type: string }[]) => ({ name, type: 'function', inputs })
const ABI = {
    unwrap: fn('unwrap', [
        { name: 'amount', type: 'uint256' },
        { name: 'chainId', type: 'uint256' },
    ]),
    transfer: fn('transfer', [
        { name: 'to', type: 'address' },
        { name: 'amount', type: 'uint256' },
    ]),
    withdraw: fn('withdraw', [{ name: 'wad', type: 'uint256' }]),
    deposit: fn('deposit', []),
}
const encode = (abi: any, args: unknown[]) => new Web3().eth.abi.encodeFunctionCall(abi, args as any)
const TRANSFER_TOPIC = Web3.utils.sha3('Transfer(address,address,uint256)') as string

type Direction = 'onboard' | 'offboard'

interface FeeConfig {
    min: bigint
    max: bigint
    pct: bigint
    pctDecimals: bigint
}

export interface BridgeSettingsView {
    operational: boolean
    blocked: (address: string) => boolean
    /** The bridge's wallet on Ethereum: receives deposits, pays out. */
    ethereumWallet: string
    /** Whether `token` is listed with these exact addresses. */
    listed(token: BridgeToken): boolean
    fee(token: BridgeToken, direction: Direction, amount: bigint): bigint
}

function feeConfig(raw: any): FeeConfig | null {
    if (!raw) return null
    return { min: BigInt(raw.minimumFeeAmount), max: BigInt(raw.maximumFeeAmount), pct: BigInt(raw.feePercentage), pctDecimals: BigInt(raw.feePercentageDecimals) }
}

/** The parts of bridge_settings.json this provider needs. */
export function parseSettings(raw: any): BridgeSettingsView {
    const critical = raw?.critical
    if (!critical?.assets) throw new Error('The Avalanche Bridge settings are incomplete.')
    const assets = critical.assets as Record<string, any>
    const wrapFees = raw?.nonCritical?.wrapFeeApproximation ?? {}
    const unwrapFees = raw?.nonCritical?.unwrapFeeApproximation ?? {}
    const blocklist = new Set<string>((critical.addressBlocklist ?? []).map((a: string) => String(a).toLowerCase()))
    return {
        operational: critical.operationMode === 'normal' && !critical.disableFrontend,
        blocked: (a) => blocklist.has(a.toLowerCase()),
        ethereumWallet: String(critical.walletAddresses?.ethereum ?? ''),
        listed: (t) => {
            const a = assets[t.symbol]
            return (
                !!a &&
                String(a.nativeContractAddress).toLowerCase() === t.ethereum &&
                String(a.wrappedContractAddress).toLowerCase() === t.avalanche &&
                Number(a.denomination) === t.decimals
            )
        },
        // `feePercentage` is a percent with `feePercentageDecimals` decimals (25 / 3 = 0.025%), clamped to [min, max].
        fee: (t, direction, amount) => {
            const c = feeConfig((direction === 'onboard' ? wrapFees : unwrapFees)[t.symbol])
            if (!c) throw new Error(`The Avalanche Bridge has no fee for ${t.symbol} right now.`)
            const proportional = (amount * c.pct) / (BigInt(100) * BigInt(10) ** c.pctDecimals)
            return proportional < c.min ? c.min : proportional > c.max ? c.max : proportional
        },
    }
}

let settingsCache: { at: number; view: BridgeSettingsView } | null = null

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

interface Route {
    token: BridgeToken
    direction: Direction
    /** Native ETH on Ethereum: wrapped to WETH before it is sent. */
    wrapFirst: boolean
}

/** Which bridge token and direction `from` → `toChainId` is, if the bridge serves it. */
export function bridgeRoute(from: BridgeAsset, toChainId: string): Route | null {
    const addr = from.address.toLowerCase()
    if (from.chainId === 'evm:43114' && toChainId === 'evm:1') {
        const token = BRIDGE_TOKENS.find((t) => t.avalanche === addr)
        return token ? { token, direction: 'offboard', wrapFirst: false } : null
    }
    if (from.chainId === 'evm:1' && toChainId === 'evm:43114') {
        if (from.address === NATIVE) return { token: BRIDGE_TOKENS.find((t) => t.symbol === 'WETH')!, direction: 'onboard', wrapFirst: true }
        const token = BRIDGE_TOKENS.find((t) => t.ethereum === addr)
        return token ? { token, direction: 'onboard', wrapFirst: false } : null
    }
    return null
}

/** The bridge token `address` on `chainId` is part of, if any (for labels). */
export function bridgeTokenFor(chainId: string, address: string): BridgeToken | undefined {
    const a = address.toLowerCase()
    if (chainId === 'evm:43114') return BRIDGE_TOKENS.find((t) => t.avalanche === a)
    if (chainId === 'evm:1') return BRIDGE_TOKENS.find((t) => t.ethereum === a)
    return undefined
}

interface QuoteData {
    symbol: string
    direction: Direction
    wrapFirst: boolean
    ethereumWallet: string
}

export const avalancheBridgeProvider: BridgeProvider = {
    id: AVALANCHE_BRIDGE_ID,
    name: 'Avalanche Bridge',
    supersedes: ['wormhole', 'thorchain'],

    supports(from, toChain) {
        return !!bridgeRoute(from, toChain.id)
    },

    async quote(req: BridgeQuoteRequest): Promise<BridgeQuote> {
        const route = bridgeRoute(req.from, req.toChain.id)
        if (!route) throw new Error('The Avalanche Bridge does not carry this token between these chains.')
        const { token, direction } = route
        const settings = await loadSettings()
        if (!settings.operational) throw new Error('The Avalanche Bridge is paused right now. Try again later.')
        if (!settings.listed(token)) throw new Error(`The Avalanche Bridge no longer lists ${token.symbol} at the expected addresses.`)
        if (!/^0x[0-9a-fA-F]{40}$/.test(settings.ethereumWallet)) throw new Error('The Avalanche Bridge settings have no Ethereum wallet.')
        if (req.sender && settings.blocked(req.sender)) throw new Error('The Avalanche Bridge does not accept transfers from this address.')
        if (req.sender && req.recipient.toLowerCase() !== req.sender.toLowerCase()) {
            throw new Error('The Avalanche Bridge always delivers to the address that sends — set the recipient to your own address.')
        }
        const fee = settings.fee(token, direction, req.amount)
        const out = req.amount - fee
        const unit = (v: bigint) => `${Number(v) / 10 ** token.decimals}`
        if (out <= BigInt(0)) {
            throw Object.assign(new Error(`The Avalanche Bridge fee is about ${unit(fee)} ${token.symbol} — send more than that.`), { code: 'below_min' })
        }
        const onboard = direction === 'onboard'
        const receiveAsset: BridgeAsset = onboard
            ? { chainId: 'evm:43114', address: Web3.utils.toChecksumAddress(token.avalanche), symbol: `${token.symbol}.e`, decimals: token.decimals, name: `${token.name} (Avalanche Bridge)` }
            : { chainId: 'evm:1', address: Web3.utils.toChecksumAddress(token.ethereum), symbol: token.symbol, decimals: token.decimals, name: token.name }
        const fees: BridgeFee[] = [{ label: 'Avalanche Bridge fee (estimate)', amount: fee, symbol: token.symbol, decimals: token.decimals, paidAs: 'deducted' }]
        const warnings: string[] = []
        if (onboard) {
            warnings.push(
                `Arrives as ${token.symbol}.e (${receiveAsset.address}) at your own address on Avalanche — the Avalanche Bridge's token${
                    token.symbol === 'USDC' || token.symbol === 'USDT' ? `, not the native ${token.symbol} on Avalanche` : ''
                }.`
            )
            if (route.wrapFirst) warnings.push('Your ETH is wrapped to WETH first, then sent: two transactions on Ethereum.')
        } else {
            warnings.push(
                `Arrives as ${token.symbol} (${receiveAsset.address}) at your own address on Ethereum.` +
                    (token.symbol === 'WETH' ? ' Unwrapping it to ETH is a separate, optional step (needs a little ETH for gas).' : '')
            )
        }
        warnings.push('The fee is the bridge’s estimate; the exact fee is set when the bridge processes the transfer.')
        const data: QuoteData = { symbol: token.symbol, direction, wrapFirst: route.wrapFirst, ethereumWallet: settings.ethereumWallet }
        return {
            providerId: AVALANCHE_BRIDGE_ID,
            routeId: `${ROUTE}:${direction}`,
            routeName: 'Avalanche Bridge',
            request: req,
            receive: { asset: receiveAsset, amount: out, kind: onboard ? 'wrapped' : 'canonical' },
            fees,
            etaSeconds: onboard ? ONBOARD_ETA_SECONDS : OFFBOARD_ETA_SECONDS,
            needsClaim: false,
            warnings,
            data,
        }
    },

    async execute(quote, signers, onProgress) {
        const data = quote.data as QuoteData
        const token = BRIDGE_TOKENS.find((t) => t.symbol === data.symbol)
        if (!token) throw new Error('Unknown bridge token.')
        const amount = quote.request.amount.toString()

        if (data.direction === 'offboard') {
            const src = getBridgeChain('evm:43114')
            const signer = src ? signers.evm(src) : null
            if (!signer) throw new Error('Bridging from Avalanche needs your wallet on Avalanche C-Chain. Switch to it first.')
            await signer.assertOnChain()
            const step = `Send ${token.symbol}.e to the Avalanche Bridge`
            onProgress?.(step, 'running')
            const hash = await sendAndWait(signer, { to: Web3.utils.toChecksumAddress(token.avalanche), data: encode(ABI.unwrap, [amount, String(ETHEREUM_BRIDGE_CHAIN)]), label: step }, UNWRAP_GAS)
            onProgress?.(step, 'done')
            return newTransfer(quote, hash, { direction: 'offboard', symbol: token.symbol, ethereumWallet: data.ethereumWallet, sentAt: Date.now() })
        }

        // Onboarding: the deposit goes to the bridge wallet from the LIVE settings, re-read now.
        const settings = await loadSettings()
        if (settings.ethereumWallet.toLowerCase() !== data.ethereumWallet.toLowerCase()) {
            throw new Error('The Avalanche Bridge wallet changed since this quote. Get a new quote.')
        }
        const src = getBridgeChain('evm:1')
        const signer = src ? signers.evm(src) : null
        if (!signer) throw new Error('Bridging from Ethereum needs your wallet on Ethereum. Switch to it first.')
        await signer.assertOnChain()
        // Where to start looking for the mint on Avalanche.
        const avalanche = getEvmNetworkByChainId(43114)
        const fromBlock = avalanche ? Number(await web3For(avalanche).eth.getBlockNumber()) : 0
        if (data.wrapFirst) {
            const wrap = 'Wrap ETH to WETH'
            onProgress?.(wrap, 'running')
            await sendAndWait(signer, { to: WETH_ETHEREUM, data: encode(ABI.deposit, []), value: new BN(amount), label: wrap }, WETH_GAS)
            onProgress?.(wrap, 'done')
        }
        const step = `Send ${token.symbol} to the Avalanche Bridge`
        onProgress?.(step, 'running')
        const hash = await sendAndWait(
            signer,
            { to: Web3.utils.toChecksumAddress(token.ethereum), data: encode(ABI.transfer, [Web3.utils.toChecksumAddress(settings.ethereumWallet), amount]), label: step },
            TRANSFER_GAS
        )
        onProgress?.(step, 'done')
        return newTransfer(quote, hash, { direction: 'onboard', symbol: token.symbol, avalancheFromBlock: fromBlock, sentAt: Date.now() })
    },

    async refresh(transfer: BridgeTransfer): Promise<BridgeTransfer> {
        const updated = Object.assign({}, transfer, { updatedAt: Date.now() })
        if (transfer.status === 'completed') return updated
        const token = BRIDGE_TOKENS.find((t) => t.symbol === transfer.data.symbol)
        if (!token) return updated
        return transfer.data.direction === 'onboard' ? refreshOnboard(updated, token) : refreshOffboard(updated, token)
    },

    followUp: {
        label: 'Unwrap WETH to ETH',
        available: (t) => t.status === 'completed' && t.data.direction === 'offboard' && t.data.symbol === 'WETH' && !!t.data.received && !t.data.unwrapTxHash,
        async run(transfer, signers, onProgress) {
            const eth = getBridgeChain('evm:1')
            const signer = eth ? signers.evm(eth) : null
            if (!signer) throw new Error('Unwrapping needs your wallet on Ethereum. Switch to it first.')
            await signer.assertOnChain()
            const step = 'Unwrap WETH to ETH on Ethereum'
            onProgress?.(step, 'running')
            const hash = await sendAndWait(signer, { to: WETH_ETHEREUM, data: encode(ABI.withdraw, [String(transfer.data.received)]), value: new BN(0), label: step }, WETH_GAS)
            onProgress?.(step, 'done')
            return Object.assign({}, transfer, {
                updatedAt: Date.now(),
                statusDetail: 'Arrived as WETH, unwrapped to ETH.',
                data: Object.assign({}, transfer.data, { unwrapTxHash: hash }),
            })
        },
    },
}

async function sendAndWait(signer: any, req: { to: string; data: string; value?: BN; label: string }, fallbackGas: number): Promise<string> {
    const gasLimit = await signer.estimateGas(req, fallbackGas)
    const hash = await signer.send(Object.assign({}, req, { gasLimit }))
    if (isOfflineTxId(hash)) throw new Error('Bridging needs each transaction broadcast. Turn off offline signing to bridge.')
    const receipt = await signer.waitForReceipt(hash)
    if (!receipt.status) throw new Error(`${req.label} failed on chain.`)
    return receipt.txHash
}

/** Avalanche → Ethereum: the bridge wallet's ERC-20 payout to the recipient, found through Blockscout. */
async function refreshOffboard(t: BridgeTransfer, token: BridgeToken): Promise<BridgeTransfer> {
    const wallet = String(t.data.ethereumWallet ?? '').toLowerCase()
    const { data } = await axios.get(`${BLOCKSCOUT_ETH}/addresses/${t.recipient}/token-transfers`, {
        params: { type: 'ERC-20', filter: 'to', token: Web3.utils.toChecksumAddress(token.ethereum) },
        timeout: TIMEOUT_MS,
    })
    const sentAt = Number(t.data.sentAt ?? t.createdAt)
    const sent = BigInt(t.amountIn)
    const payout = (Array.isArray(data?.items) ? data.items : []).find((x: any) => {
        if (String(x?.from?.hash ?? '').toLowerCase() !== wallet) return false
        const value = BigInt(String(x?.total?.value ?? '0'))
        const when = x?.timestamp ? Date.parse(x.timestamp) : sentAt
        // The amount sent minus a fee, paid after the send.
        return value > BigInt(0) && value <= sent && when >= sentAt - 5 * 60_000
    })
    if (!payout) return Object.assign(t, { status: 'in_transit' as const, statusDetail: 'Waiting for the bridge to pay out on Ethereum.' })
    return Object.assign(t, {
        status: 'completed' as const,
        statusDetail: `Arrived as ${token.symbol} on Ethereum.`,
        destTxHash: String(payout.transaction_hash),
        data: Object.assign({}, t.data, { received: String(payout.total.value) }),
    })
}

/** Ethereum → Avalanche: the ".e" token minted to the recipient, from Avalanche's own logs. */
async function refreshOnboard(t: BridgeTransfer, token: BridgeToken): Promise<BridgeTransfer> {
    const network = getEvmNetworkByChainId(43114)
    if (!network) return t
    const web3 = web3For(network)
    const head = Number(await web3.eth.getBlockNumber())
    let from = Number(t.data.scannedTo ?? t.data.avalancheFromBlock ?? head - LOG_CHUNK)
    const zero = '0x' + '0'.repeat(64)
    const to = '0x' + '0'.repeat(24) + t.recipient.toLowerCase().replace(/^0x/, '')
    const sent = BigInt(t.amountIn)
    for (let n = 0; n < MAX_LOG_CHUNKS_PER_REFRESH && from <= head; n++) {
        const end = Math.min(from + LOG_CHUNK - 1, head)
        const logs = await web3.eth.getPastLogs({ address: Web3.utils.toChecksumAddress(token.avalanche), topics: [TRANSFER_TOPIC, zero, to], fromBlock: from, toBlock: end })
        const mint = logs.find((l: any) => {
            const v = BigInt(l.data)
            return v > BigInt(0) && v <= sent
        })
        if (mint) {
            return Object.assign(t, {
                status: 'completed' as const,
                statusDetail: `Arrived as ${token.symbol}.e on Avalanche.`,
                destTxHash: (mint as any).transactionHash,
                data: Object.assign({}, t.data, { received: BigInt((mint as any).data).toString(), scannedTo: end }),
            })
        }
        from = end + 1
    }
    return Object.assign(t, {
        status: 'in_transit' as const,
        statusDetail: 'Waiting for Ethereum confirmations and the bridge to mint on Avalanche.',
        data: Object.assign({}, t.data, { scannedTo: from }),
    })
}

/** Where to follow a transfer: the destination payout once known, else the sending transaction. */
export function avalancheBridgeTrackerUrl(transfer: BridgeTransfer): string {
    const onboard = transfer.data.direction === 'onboard'
    if (transfer.destTxHash) return onboard ? `https://snowtrace.io/tx/${transfer.destTxHash}` : `https://etherscan.io/tx/${transfer.destTxHash}`
    return onboard ? `https://etherscan.io/tx/${transfer.sourceTxHash}` : `https://snowtrace.io/tx/${transfer.sourceTxHash}`
}
