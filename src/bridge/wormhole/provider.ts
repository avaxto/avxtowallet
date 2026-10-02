/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Wormhole, as a `BridgeProvider`. Two routes:
 *
 *  - **Token Bridge** — any ERC-20, any chain's native coin, any SPL token,
 *    between every EVM chain Wormhole serves (Avalanche C-Chain included) and
 *    Solana. The destination receives Wormhole's wrapped version of the token,
 *    or the original back on its home chain (native coins unwrap). Manual
 *    delivery: once Wormhole's guardians sign the transfer, the user claims it
 *    on the destination, paying that chain's gas.
 *  - **NTT** (Native Token Transfers) — AVXTO as itself, through the issuer's
 *    own NTT contracts (./nttConfig.ts). Relayed automatically when the
 *    deployment offers it, otherwise claimed like the Token Bridge.
 *
 * The SDK only BUILDS transactions; they are signed and sent by the wallet's
 * own signers, so the session password prompt, the wrong-chain guard and the
 * extension's confirmation all apply exactly as for any other send.
 */
import { BN } from '@/avalanche'
import { isOfflineTxId } from '@/stores/offlineSigning'
import type { EvmSigner } from '@/evm/signer'
import { AVXTO_CONTRACT_ADDRESS, TESTNET_AVXTO_CONTRACT_ADDRESS } from '@/avxto/AVXTOConf'
import { getBridgeChain } from '../chains'
import {
    NATIVE,
    newTransfer,
    type BridgeAsset,
    type BridgeChain,
    type BridgeFee,
    type BridgeProgress,
    type BridgeProvider,
    type BridgeQuote,
    type BridgeQuoteRequest,
    type BridgeSigners,
    type BridgeTransfer,
    type ReceiveKind,
} from '../types'
import { wormholeChainFor, wormholeFinalitySeconds, type WormholeNetwork } from './chains'
import { getWormhole, wormholeStatics } from './context'
import { isDeployed, nttContracts, nttDeploymentForToken, type NttTokenDeployment } from './nttConfig'

export const WORMHOLE_ID = 'wormhole'
const TOKEN_BRIDGE = 'wormhole:token-bridge'
const NTT = 'wormhole:ntt'

/** Gas fallbacks when estimation fails: approvals, and bridge/claim calls. */
const APPROVE_GAS = 80_000
const BRIDGE_GAS = 400_000

/** Wormhole carries amounts at 8 decimals; anything finer stays with the sender. */
export function truncateTo8(amount: bigint, decimals: number): bigint {
    if (decimals <= 8) return amount
    const unit = BigInt(10) ** BigInt(decimals - 8)
    return (amount / unit) * unit
}

/** `amount` (in `fromDec`) expressed in `toDec`, after Wormhole's 8-decimal truncation. */
export function convertAmount(amount: bigint, fromDec: number, toDec: number): bigint {
    const t = truncateTo8(amount, fromDec)
    if (toDec === fromDec) return t
    return toDec > fromDec
        ? t * BigInt(10) ** BigInt(toDec - fromDec)
        : t / BigInt(10) ** BigInt(fromDec - toDec)
}

/** Whether `asset` is AVXTO (by its known hub addresses or any NTT deployment's token). */
function nttDeploymentFor(asset: BridgeAsset, network: WormholeNetwork, chain: string): NttTokenDeployment | undefined {
    if (asset.address === NATIVE) return undefined
    return nttDeploymentForToken(network, chain, asset.address)
}

function isAvxto(asset: BridgeAsset): boolean {
    const a = asset.address.toLowerCase()
    return a === AVXTO_CONTRACT_ADDRESS.toLowerCase() || a === TESTNET_AVXTO_CONTRACT_ADDRESS.toLowerCase()
}

interface RouteData {
    route: typeof TOKEN_BRIDGE | typeof NTT
    network: WormholeNetwork
    srcChain: string
    dstChain: string
    /** Token on the source: `NATIVE` or an address. */
    token: string
    /** What arrives: the destination token's address, or `NATIVE` when it unwraps to the native coin. */
    dstToken: string
    unwrapNative: boolean
    automatic: boolean
}

function chainsFor(req: { from: BridgeAsset; toChain: BridgeChain }) {
    const src = getBridgeChain(req.from.chainId)
    const srcRef = src ? wormholeChainFor(src) : null
    const dstRef = wormholeChainFor(req.toChain)
    if (!src || !srcRef || !dstRef) throw new Error('Wormhole does not serve this pair of chains.')
    if (srcRef.network !== dstRef.network) throw new Error('Cannot bridge between a mainnet and a testnet.')
    return { src, srcRef, dstRef, network: srcRef.network }
}

// ─── Sending ───────────────────────────────────────────────────────────────

/** Sends the SDK's EVM transactions in order through the wallet's signer; returns the last hash. */
async function sendEvm(signer: EvmSigner, txs: AsyncIterable<any>, onProgress?: BridgeProgress): Promise<string> {
    await signer.assertOnChain()
    let last = ''
    for await (const unsigned of txs) {
        const t = unsigned.transaction
        const step = String(unsigned.description ?? 'Transaction')
        onProgress?.(step, 'running')
        const req = {
            to: String(t.to),
            data: t.data ? String(t.data) : undefined,
            value: t.value ? new BN(BigInt(t.value).toString()) : undefined,
            label: step,
        }
        const isApprove = /approve/i.test(step)
        const gasLimit = await signer.estimateGas(req, isApprove ? APPROVE_GAS : BRIDGE_GAS)
        const hash = await signer.send({ ...req, gasLimit })
        if (isOfflineTxId(hash)) {
            throw new Error('Bridging needs each step broadcast and confirmed. Turn off offline signing to bridge.')
        }
        const receipt = await signer.waitForReceipt(hash)
        if (!receipt.status) throw new Error(`${step} failed on chain.`)
        last = receipt.txHash
        onProgress?.(step, 'done')
    }
    if (!last) throw new Error('Wormhole built no transaction to send.')
    return last
}

/** Sends the SDK's Solana transactions in order; returns the last signature. */
async function sendSolana(
    wallet: { sendTransaction(tx: any, signers?: any[]): Promise<string> },
    txs: AsyncIterable<any>,
    onProgress?: BridgeProgress
): Promise<string> {
    let last = ''
    for await (const unsigned of txs) {
        const step = String(unsigned.description ?? 'Transaction')
        onProgress?.(step, 'running')
        const { transaction, signers } = unsigned.transaction
        last = await wallet.sendTransaction(transaction, signers ?? [])
        onProgress?.(step, 'done')
    }
    if (!last) throw new Error('Wormhole built no transaction to send.')
    return last
}

function requireSigner<T>(signer: T | null, chain: BridgeChain, what: string): T {
    if (!signer) {
        throw new Error(
            chain.kind === 'evm'
                ? `${what} needs your wallet on ${chain.name}. Switch the EVM wallet to ${chain.name} first.`
                : `${what} needs a ${chain.name} wallet. Connect one first.`
        )
    }
    return signer
}

async function send(
    chain: BridgeChain,
    signers: BridgeSigners,
    txs: AsyncIterable<any>,
    what: string,
    onProgress?: BridgeProgress
): Promise<{ hash: string; address: string }> {
    if (chain.kind === 'evm') {
        const s = requireSigner(signers.evm(chain), chain, what)
        return { hash: await sendEvm(s, txs, onProgress), address: s.address }
    }
    if (chain.kind === 'solana') {
        const w = requireSigner(signers.solana(chain), chain, what)
        return { hash: await sendSolana(w, txs, onProgress), address: w.address }
    }
    throw new Error('Wormhole does not serve Bitcoin.')
}

/** The address that will sign on `chain` — needed before the SDK can build. */
function signerAddress(chain: BridgeChain, signers: BridgeSigners, what: string): string {
    if (chain.kind === 'evm') return requireSigner(signers.evm(chain), chain, what).address
    if (chain.kind === 'solana') return requireSigner(signers.solana(chain), chain, what).address
    throw new Error('Wormhole does not serve Bitcoin.')
}

// ─── Token Bridge ──────────────────────────────────────────────────────────

async function quoteTokenBridge(req: BridgeQuoteRequest): Promise<BridgeQuote> {
    const { srcRef, dstRef, network } = chainsFor(req)
    const W = await wormholeStatics()
    const wh = await getWormhole(network)
    const srcCtx = wh.getChain(srcRef.chain)
    const dstCtx = wh.getChain(dstRef.chain)
    const [srcTb, dstTb] = await Promise.all([srcCtx.getTokenBridge(), dstCtx.getTokenBridge()])

    // Where the token comes from originally: a native coin travels as its
    // wrapped form (WAVAX, WETH…); a Wormhole-wrapped token as its original.
    const isNativeIn = req.from.address === NATIVE
    let origin: any
    if (isNativeIn) {
        origin = { chain: srcRef.chain, address: await srcTb.getWrappedNative() }
    } else if (await srcTb.isWrappedAsset(W.parseAddress(srcRef.chain, req.from.address))) {
        origin = await srcTb.getOriginalAsset(W.parseAddress(srcRef.chain, req.from.address))
    } else {
        origin = W.tokenId(srcRef.chain, req.from.address)
    }

    const toChain = req.toChain
    let dstToken: string
    let dstDecimals: number
    let kind: ReceiveKind
    let symbol = req.from.symbol
    let unwrapNative = false

    if (origin.chain === dstRef.chain) {
        // Coming home: the original token — and a native coin unwraps. The
        // origin may be in Wormhole's universal (32-byte) form; read it as
        // this chain's own address.
        const originAddr = W.canonicalAddress(origin)
        const dstWrappedNative = (await dstTb.getWrappedNative()).toString()
        if (originAddr.toLowerCase() === dstWrappedNative.toLowerCase()) {
            dstToken = NATIVE
            dstDecimals = toChain.native.decimals
            symbol = toChain.native.symbol
            kind = 'native'
            unwrapNative = true
        } else {
            dstToken = originAddr
            dstDecimals = await dstCtx.getDecimals(W.parseAddress(dstRef.chain, originAddr))
            kind = 'canonical'
        }
    } else {
        if (!(await dstTb.hasWrappedAsset(origin))) {
            throw new Error(
                `${req.from.symbol} is not registered on ${toChain.name} with Wormhole yet, so it cannot arrive there. ` +
                    'A token has to be attested on a chain before the Token Bridge can deliver it.'
            )
        }
        const wrapped = await dstTb.getWrappedAsset(origin)
        dstToken = wrapped.toString()
        dstDecimals = await dstCtx.getDecimals(wrapped)
        kind = 'wrapped'
    }

    const amountOut = convertAmount(req.amount, req.from.decimals, dstDecimals)
    if (amountOut <= BigInt(0)) throw new Error('The amount is too small: Wormhole carries 8 decimal places.')

    const fees: BridgeFee[] = []
    try {
        const messageFee: bigint = await (await srcCtx.getWormholeCore()).getMessageFee()
        if (messageFee > BigInt(0)) {
            const src = getBridgeChain(req.from.chainId)!
            fees.push({
                label: 'Wormhole message fee',
                amount: messageFee,
                symbol: src.native.symbol,
                decimals: src.native.decimals,
                paidAs: 'source',
            })
        }
    } catch {
        /* fee unreadable — the transaction itself will include whatever is due */
    }

    const warnings = [
        `Finishing needs a claim on ${toChain.name}, paid in ${toChain.native.symbol} for gas — make sure the receiving wallet has some.`,
    ]
    if (truncateTo8(req.amount, req.from.decimals) !== req.amount) {
        warnings.push('Wormhole carries 8 decimal places; the finer remainder stays in your wallet.')
    }
    if (kind === 'wrapped') {
        warnings.push(`You receive Wormhole-wrapped ${symbol} on ${toChain.name}, not the chain's own ${symbol}.`)
    }

    const data: RouteData = {
        route: TOKEN_BRIDGE,
        network,
        srcChain: srcRef.chain,
        dstChain: dstRef.chain,
        token: req.from.address,
        dstToken,
        unwrapNative,
        automatic: false,
    }
    return {
        providerId: WORMHOLE_ID,
        routeId: TOKEN_BRIDGE,
        routeName: 'Wormhole Token Bridge',
        request: req,
        receive: {
            asset: { chainId: toChain.id, address: dstToken, symbol, decimals: dstDecimals },
            amount: amountOut,
            kind,
        },
        fees,
        etaSeconds: wormholeFinalitySeconds(srcRef.chain) + 60,
        needsClaim: true,
        warnings,
        data,
    }
}

// ─── NTT ───────────────────────────────────────────────────────────────────

async function quoteNtt(req: BridgeQuoteRequest, deployment: NttTokenDeployment): Promise<BridgeQuote> {
    const { srcRef, dstRef, network } = chainsFor(req)
    const toChain = req.toChain
    if (!isDeployed(deployment.chains[srcRef.chain]) || !isDeployed(deployment.chains[dstRef.chain])) {
        throw new Error(
            `${deployment.symbol} bridging to ${toChain.name} opens with its Wormhole NTT deployment, which is not set up yet.`
        )
    }
    const wh = await getWormhole(network)
    const srcNtt = await wh.getChain(srcRef.chain).getProtocol('Ntt', { ntt: nttContracts(deployment, srcRef.chain) })

    // queue: false — a transfer over the rate limit reverts instead of waiting
    // a day in a queue; check capacity up front so it never gets that far.
    const capacity: bigint = await srcNtt.getCurrentOutboundCapacity()
    if (req.amount > capacity) {
        throw new Error(`${deployment.symbol} can move at most ${capacity.toString()} base units out of ${srcRef.chain} right now (rate limit).`)
    }

    let automatic = false
    let deliveryPrice = BigInt(0)
    try {
        deliveryPrice = await srcNtt.quoteDeliveryPrice(dstRef.chain, { queue: false, automatic: true })
        automatic = true
    } catch {
        // No relaying on this deployment: the user claims on the destination.
    }

    const src = getBridgeChain(req.from.chainId)!
    const fees: BridgeFee[] = automatic
        ? [{ label: 'Automatic delivery', amount: deliveryPrice, symbol: src.native.symbol, decimals: src.native.decimals, paidAs: 'source' }]
        : []
    const dstToken = deployment.chains[dstRef.chain].token
    const amountOut = convertAmount(req.amount, req.from.decimals, deployment.decimals)
    const warnings = automatic
        ? []
        : [`Finishing needs a claim on ${toChain.name}, paid in ${toChain.native.symbol} for gas.`]

    const data: RouteData = {
        route: NTT,
        network,
        srcChain: srcRef.chain,
        dstChain: dstRef.chain,
        token: req.from.address,
        dstToken,
        unwrapNative: false,
        automatic,
    }
    return {
        providerId: WORMHOLE_ID,
        routeId: NTT,
        routeName: `Wormhole NTT (${deployment.symbol})`,
        request: req,
        receive: {
            asset: { chainId: toChain.id, address: dstToken, symbol: deployment.symbol, decimals: deployment.decimals },
            amount: amountOut,
            kind: 'canonical',
        },
        fees,
        etaSeconds: wormholeFinalitySeconds(srcRef.chain) + (automatic ? 120 : 60),
        needsClaim: !automatic,
        warnings,
        data,
    }
}

function deploymentOf(data: RouteData): NttTokenDeployment {
    const d = nttDeploymentForToken(data.network, data.srcChain, data.token)
    if (!d) throw new Error('The NTT deployment for this transfer is no longer configured.')
    return d
}

// ─── The provider ──────────────────────────────────────────────────────────

export const wormholeProvider: BridgeProvider = {
    id: WORMHOLE_ID,
    name: 'Wormhole',

    supports(from, toChain) {
        const src = getBridgeChain(from.chainId)
        if (!src) return false
        const a = wormholeChainFor(src)
        const b = wormholeChainFor(toChain)
        return !!a && !!b && a.network === b.network && a.chain !== b.chain
    },

    async quote(req) {
        const { srcRef, network } = chainsFor(req)
        const deployment = nttDeploymentFor(req.from, network, srcRef.chain)
        if (deployment) return quoteNtt(req, deployment)
        if (isAvxto(req.from)) {
            throw new Error('AVXTO bridges only through its official Wormhole NTT deployment, which is not set up yet.')
        }
        return quoteTokenBridge(req)
    },

    async execute(quote, signers, onProgress) {
        const data = quote.data as RouteData
        const src = getBridgeChain(quote.request.from.chainId)!
        const W = await wormholeStatics()
        const wh = await getWormhole(data.network)
        const srcCtx = wh.getChain(data.srcChain)
        const dstCtx = wh.getChain(data.dstChain)
        const sender = W.parseAddress(data.srcChain, signerAddress(src, signers, 'Bridging'))

        // A Solana recipient receives into its token account for the arriving token, not its wallet address.
        let recipient = W.chainAddress(data.dstChain, quote.request.recipient)
        if (quote.request.toChain.kind === 'solana' && data.dstToken !== NATIVE) {
            recipient = await dstCtx.getTokenAccount(
                W.parseAddress(data.dstChain, quote.request.recipient),
                W.parseAddress(data.dstChain, data.dstToken)
            )
        }

        let txs: AsyncIterable<any>
        if (data.route === NTT) {
            const ntt = await srcCtx.getProtocol('Ntt', { ntt: nttContracts(deploymentOf(data), data.srcChain) })
            txs = ntt.transfer(sender, quote.request.amount, recipient, { queue: false, automatic: data.automatic })
        } else {
            const tb = await srcCtx.getTokenBridge()
            const token = data.token === NATIVE ? 'native' : W.parseAddress(data.srcChain, data.token)
            txs = tb.transfer(sender, recipient, token, quote.request.amount)
        }

        const { hash } = await send(src, signers, txs, 'Bridging', onProgress)
        return newTransfer(quote, hash, { ...data })
    },

    async refresh(transfer) {
        const data = transfer.data as unknown as RouteData
        const wh = await getWormhole(data.network)
        const isNtt = data.route === NTT
        const vaa = await wh.getVaa(transfer.sourceTxHash, isNtt ? 'Ntt:WormholeTransfer' : 'TokenBridge:Transfer', 3000)
        const updated = { ...transfer, updatedAt: Date.now() }
        if (!vaa) {
            return { ...updated, status: 'in_transit', statusDetail: 'Waiting for Wormhole guardians to sign the transfer.' }
        }
        const dstCtx = wh.getChain(data.dstChain)
        let done: boolean
        if (isNtt) {
            const ntt = await dstCtx.getProtocol('Ntt', { ntt: nttContracts(deploymentOf(data), data.dstChain) })
            done = await ntt.getIsExecuted(vaa)
        } else {
            done = await (await dstCtx.getTokenBridge()).isTransferCompleted(vaa)
        }
        if (done) return { ...updated, status: 'completed', statusDetail: 'Delivered.' }
        if (isNtt && data.automatic) {
            return { ...updated, status: 'in_transit', statusDetail: 'Signed; the relayer is delivering it.' }
        }
        return { ...updated, status: 'ready_to_claim', statusDetail: 'Signed by Wormhole. Claim it on the destination.' }
    },

    async claim(transfer, signers, onProgress) {
        const data = transfer.data as unknown as RouteData
        const dst = getBridgeChain(transfer.toChainId)
        if (!dst) throw new Error('The destination chain is no longer configured.')
        const W = await wormholeStatics()
        const wh = await getWormhole(data.network)
        const isNtt = data.route === NTT
        const vaa = await wh.getVaa(transfer.sourceTxHash, isNtt ? 'Ntt:WormholeTransfer' : 'TokenBridge:Transfer', 10_000)
        if (!vaa) throw new Error('Wormhole has not signed this transfer yet. Try again in a few minutes.')

        const dstCtx = wh.getChain(data.dstChain)
        const payer = W.parseAddress(data.dstChain, signerAddress(dst, signers, 'Claiming'))
        let txs: AsyncIterable<any>
        if (isNtt) {
            const ntt = await dstCtx.getProtocol('Ntt', { ntt: nttContracts(deploymentOf(data), data.dstChain) })
            txs = ntt.redeem([vaa], payer)
        } else {
            txs = (await dstCtx.getTokenBridge()).redeem(payer, vaa, data.unwrapNative)
        }
        const { hash } = await send(dst, signers, txs, 'Claiming', onProgress)
        return { ...transfer, status: 'completed', statusDetail: 'Claimed.', destTxHash: hash, updatedAt: Date.now() }
    },
}

/** Wormholescan link for a source transaction. */
export function wormholescanUrl(transfer: BridgeTransfer): string {
    const network = (transfer.data as any)?.network === 'Testnet' ? 'Testnet' : 'Mainnet'
    return `https://wormholescan.io/#/tx/${transfer.sourceTxHash}?network=${network}`
}
