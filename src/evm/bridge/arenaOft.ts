/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * ARENA bridge between Avalanche C-Chain and Robinhood Chain, via LayerZero V2
 * OFT. Both directions.
 *
 * Verified directly against the live contracts:
 *
 *   - `0xA59Ad32d…F86f7` on Avalanche is an **OFT Adapter**: `token()` returns
 *     the ARENA ERC-20, `approvalRequired()` is true, and `oftVersion()`
 *     reports interface 0x02e49c2c / version 1. It locks ARENA on Avalanche.
 *   - `0x50832d74…9Aa6` on Robinhood Chain is the **OFT itself** — it is both
 *     the ARENA token and the bridge contract, and `approvalRequired()` is
 *     false, because it burns the caller's own balance rather than pulling it.
 *     That is why the Robinhood -> Avalanche direction has no approve step.
 *   - `peers()` resolves symmetrically, which is what proves the endpoint ids:
 *     the adapter's `peers(30416)` is the Robinhood OFT, and the Robinhood
 *     OFT's `peers(30106)` is the adapter.
 *   - The send call is the same both ways:
 *     `send((uint32,bytes32,uint256,uint256,bytes,bytes,bytes),(uint256,uint256),address)`
 *     with `msg.value` equal to the quoted `nativeFee`, and empty
 *     extraOptions/composeMsg/oftCmd (both contracts carry enforced options, so
 *     none need to be supplied here).
 *
 * Two behaviours are easy to miss and expensive to get wrong, and both apply in
 * either direction:
 *
 *   - `sharedDecimals()` is **6** while ARENA is an 18-decimal token, giving a
 *     `decimalConversionRate()` of 1e12. Any amount that is not a whole
 *     multiple of 1e12 is silently truncated — the remainder is simply not
 *     bridged. So amounts are floored here, deliberately and visibly.
 *   - `maxTransferAmount()` is a per-transfer cap (4,670,000 ARENA at the time
 *     of writing) that the owner has already changed several times. It is
 *     enforced inside the contract's own quote path, so exceeding it makes
 *     `quoteOFT` itself revert with `TransferCapExceeded(requested, cap)`
 *     rather than producing a quote. It is checked up front here so that turns
 *     into a sentence rather than an unexplained call failure.
 *
 * Both numbers are read from the contract at runtime rather than hardcoded.
 */
import type { EvmNetwork } from '../networkRegistry'
import { getEvmNetworkByChainId } from '../networkRegistry'
import { web3For } from '../providers'

/** ARENA ERC-20 on Avalanche C-Chain — the token locked by the adapter. */
export const ARENA_TOKEN_AVALANCHE = '0xB8d7710f7d8349A506b75dD184F05777c82dAd0C'

/**
 * ARENA on Robinhood Chain.
 *
 * This one address is the token *and* the OFT: sends going the other way are
 * issued against it directly, with no separate adapter and no approval.
 */
export const ARENA_TOKEN_ROBINHOOD = '0x50832d74a7160E2f7d361F5E678E107D228B9Aa6'

/** The LayerZero V2 OFT Adapter that locks ARENA on Avalanche. */
export const ARENA_OFT_ADAPTER = '0xA59Ad32dAd425250ca3601F964d92611818F86f7'

/**
 * LayerZero V2 endpoint ids.
 *
 * Not chain ids — LayerZero keeps its own address space (mainnet ids are
 * 30xxx). Both confirmed by `peers()` resolving to the opposite contract.
 */
export const AVALANCHE_LZ_EID = 30106
export const ROBINHOOD_LZ_EID = 30416

export const AVALANCHE_CHAIN_ID = 43114
export const ROBINHOOD_CHAIN_ID = 4663

const OFT_ABI: any[] = [
    {
        name: 'quoteSend',
        type: 'function',
        stateMutability: 'view',
        inputs: [
            {
                name: '_sendParam',
                type: 'tuple',
                components: [
                    { name: 'dstEid', type: 'uint32' },
                    { name: 'to', type: 'bytes32' },
                    { name: 'amountLD', type: 'uint256' },
                    { name: 'minAmountLD', type: 'uint256' },
                    { name: 'extraOptions', type: 'bytes' },
                    { name: 'composeMsg', type: 'bytes' },
                    { name: 'oftCmd', type: 'bytes' },
                ],
            },
            { name: '_payInLzToken', type: 'bool' },
        ],
        outputs: [
            {
                name: 'msgFee',
                type: 'tuple',
                components: [
                    { name: 'nativeFee', type: 'uint256' },
                    { name: 'lzTokenFee', type: 'uint256' },
                ],
            },
        ],
    },
    {
        name: 'quoteOFT',
        type: 'function',
        stateMutability: 'view',
        inputs: [
            {
                name: '_sendParam',
                type: 'tuple',
                components: [
                    { name: 'dstEid', type: 'uint32' },
                    { name: 'to', type: 'bytes32' },
                    { name: 'amountLD', type: 'uint256' },
                    { name: 'minAmountLD', type: 'uint256' },
                    { name: 'extraOptions', type: 'bytes' },
                    { name: 'composeMsg', type: 'bytes' },
                    { name: 'oftCmd', type: 'bytes' },
                ],
            },
        ],
        outputs: [
            {
                name: 'oftLimit',
                type: 'tuple',
                components: [
                    { name: 'minAmountLD', type: 'uint256' },
                    { name: 'maxAmountLD', type: 'uint256' },
                ],
            },
            {
                name: 'oftFeeDetails',
                type: 'tuple[]',
                components: [
                    { name: 'feeAmountLD', type: 'int256' },
                    { name: 'description', type: 'string' },
                ],
            },
            {
                name: 'oftReceipt',
                type: 'tuple',
                components: [
                    { name: 'amountSentLD', type: 'uint256' },
                    { name: 'amountReceivedLD', type: 'uint256' },
                ],
            },
        ],
    },
    {
        name: 'send',
        type: 'function',
        stateMutability: 'payable',
        inputs: [
            {
                name: '_sendParam',
                type: 'tuple',
                components: [
                    { name: 'dstEid', type: 'uint32' },
                    { name: 'to', type: 'bytes32' },
                    { name: 'amountLD', type: 'uint256' },
                    { name: 'minAmountLD', type: 'uint256' },
                    { name: 'extraOptions', type: 'bytes' },
                    { name: 'composeMsg', type: 'bytes' },
                    { name: 'oftCmd', type: 'bytes' },
                ],
            },
            {
                name: '_fee',
                type: 'tuple',
                components: [
                    { name: 'nativeFee', type: 'uint256' },
                    { name: 'lzTokenFee', type: 'uint256' },
                ],
            },
            { name: '_refundAddress', type: 'address' },
        ],
        outputs: [],
    },
    {
        name: 'decimalConversionRate',
        type: 'function',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ name: '', type: 'uint256' }],
    },
    {
        name: 'maxTransferAmount',
        type: 'function',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ name: '', type: 'uint256' }],
    },
]

const ERC20_ABI: any[] = [
    {
        name: 'balanceOf',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'account', type: 'address' }],
        outputs: [{ name: '', type: 'uint256' }],
    },
    {
        name: 'allowance',
        type: 'function',
        stateMutability: 'view',
        inputs: [
            { name: 'owner', type: 'address' },
            { name: 'spender', type: 'address' },
        ],
        outputs: [{ name: '', type: 'uint256' }],
    },
    {
        name: 'approve',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [
            { name: 'spender', type: 'address' },
            { name: 'amount', type: 'uint256' },
        ],
        outputs: [{ name: '', type: 'bool' }],
    },
]

/** ARENA's decimals on both chains. Verified identical (18) on each. */
export const ARENA_DECIMALS = 18

export type BridgeDirection = 'avalanche-to-robinhood' | 'robinhood-to-avalanche'

export const DEFAULT_DIRECTION: BridgeDirection = 'avalanche-to-robinhood'

/** Everything that differs between the two directions, in one place. */
export interface BridgeRoute {
    direction: BridgeDirection
    sourceChainId: number
    destChainId: number
    sourceName: string
    destName: string
    /** LayerZero endpoint id of the *destination* — what `dstEid` is set to. */
    dstEid: number
    /** The contract the payable `send` is issued against, on the source chain. */
    sourceContract: string
    /** ARENA on the source chain — where balances are read from. */
    sourceToken: string
    /**
     * The token that must be approved before `send`, or null when the source
     * contract burns the caller's own balance and no approval exists to give.
     */
    approvalToken: string | null
    /** Native asset paying the LayerZero fee on the source chain. */
    feeSymbol: string
    /** What the destination does with the tokens, for display. */
    mechanism: string
}

const ROUTES: Record<BridgeDirection, BridgeRoute> = {
    'avalanche-to-robinhood': {
        direction: 'avalanche-to-robinhood',
        sourceChainId: AVALANCHE_CHAIN_ID,
        destChainId: ROBINHOOD_CHAIN_ID,
        sourceName: 'Avalanche C-Chain',
        destName: 'Robinhood Chain',
        dstEid: ROBINHOOD_LZ_EID,
        sourceContract: ARENA_OFT_ADAPTER,
        sourceToken: ARENA_TOKEN_AVALANCHE,
        // An Adapter: it pulls ARENA with transferFrom, so it needs an allowance.
        approvalToken: ARENA_TOKEN_AVALANCHE,
        feeSymbol: 'AVAX',
        mechanism: 'locked on Avalanche and minted to the same address on Robinhood Chain',
    },
    'robinhood-to-avalanche': {
        direction: 'robinhood-to-avalanche',
        sourceChainId: ROBINHOOD_CHAIN_ID,
        destChainId: AVALANCHE_CHAIN_ID,
        sourceName: 'Robinhood Chain',
        destName: 'Avalanche C-Chain',
        dstEid: AVALANCHE_LZ_EID,
        // The token is the OFT — send goes straight to it.
        sourceContract: ARENA_TOKEN_ROBINHOOD,
        sourceToken: ARENA_TOKEN_ROBINHOOD,
        // `approvalRequired()` is false here: it burns from msg.sender.
        approvalToken: null,
        feeSymbol: 'ETH',
        mechanism: 'burned on Robinhood Chain and released to the same address on Avalanche',
    },
}

export function getRoute(direction: BridgeDirection): BridgeRoute {
    const route = ROUTES[direction]
    if (!route) throw new Error(`Unknown bridge direction: ${direction}`)
    return route
}

export function oppositeDirection(direction: BridgeDirection): BridgeDirection {
    return direction === 'avalanche-to-robinhood'
        ? 'robinhood-to-avalanche'
        : 'avalanche-to-robinhood'
}

export interface SendParam {
    dstEid: number
    to: string
    amountLD: string
    minAmountLD: string
    extraOptions: string
    composeMsg: string
    oftCmd: string
}

export interface BridgeQuote {
    direction: BridgeDirection
    /** What the contract will actually pull, after dust truncation. */
    amountSentLD: bigint
    /** What lands on the destination chain. */
    amountReceivedLD: bigint
    /** Native fee required as `msg.value`, in the source chain's own currency. */
    nativeFee: bigint
    /** Amount lost to the 6-shared-decimals truncation, if any. */
    dustLD: bigint
    /** The contract's current per-transfer cap, for display. */
    maxTransferLD: bigint
    /** The exact params the send must be issued with, so quote and send cannot drift. */
    sendParam: SendParam
}

/** The registry entry for a route's source chain — what it is read from and signed on. */
export function getSourceNetwork(direction: BridgeDirection): EvmNetwork {
    const route = getRoute(direction)
    const net = getEvmNetworkByChainId(route.sourceChainId)
    if (!net) {
        throw new Error(`${route.sourceName} is missing from the EVM network registry.`)
    }
    return net
}

/** Kept for callers that only ever deal with the Avalanche leg. */
export function getAvalancheNetwork(): EvmNetwork {
    return getSourceNetwork('avalanche-to-robinhood')
}

/** An EVM address as the left-padded bytes32 LayerZero addresses its recipients by. */
export function addressToBytes32(address: string): string {
    const clean = address.toLowerCase().replace(/^0x/, '')
    if (!/^[0-9a-f]{40}$/.test(clean)) throw new Error(`Invalid address: ${address}`)
    return '0x' + clean.padStart(64, '0')
}

function oftContract(direction: BridgeDirection) {
    const route = getRoute(direction)
    const web3 = web3For(getSourceNetwork(direction))
    return new web3.eth.Contract(OFT_ABI, route.sourceContract)
}

/**
 * The contract's local->shared decimal step (1e12 on both sides).
 *
 * Read from the contract rather than hardcoded: it is the single number that
 * decides how much of a user's amount is silently discarded, and a wrong
 * assumption is invisible until funds go missing.
 */
export async function getDecimalConversionRate(direction: BridgeDirection): Promise<bigint> {
    const rate: string = await oftContract(direction).methods.decimalConversionRate().call()
    return BigInt(rate)
}

/**
 * The per-transfer cap.
 *
 * Read live rather than hardcoded because the owner has already moved it
 * several times; a stale copy would reject transfers the contract would
 * happily accept, or vice versa.
 */
export async function getMaxTransferAmount(direction: BridgeDirection): Promise<bigint> {
    const max: string = await oftContract(direction).methods.maxTransferAmount().call()
    return BigInt(max)
}

/** Floors to a whole multiple of `rate` — what the contract would do anyway, made explicit. */
export function floorToConversionRate(amountLD: bigint, rate: bigint): bigint {
    if (rate <= BigInt(1)) return amountLD
    return (amountLD / rate) * rate
}

export async function getArenaBalance(direction: BridgeDirection, owner: string): Promise<bigint> {
    const route = getRoute(direction)
    const web3 = web3For(getSourceNetwork(direction))
    const token = new web3.eth.Contract(ERC20_ABI, route.sourceToken)
    return BigInt(await token.methods.balanceOf(owner).call())
}

/**
 * How much ARENA the source contract is currently allowed to pull.
 *
 * Null on the Robinhood -> Avalanche leg: the OFT burns the caller's own
 * balance, so there is no allowance in the picture at all. Null means "not
 * applicable", not "unknown" — callers should treat it as no approval needed.
 */
export async function getArenaAllowance(
    direction: BridgeDirection,
    owner: string
): Promise<bigint | null> {
    const route = getRoute(direction)
    if (!route.approvalToken) return null
    const web3 = web3For(getSourceNetwork(direction))
    const token = new web3.eth.Contract(ERC20_ABI, route.approvalToken)
    return BigInt(await token.methods.allowance(owner, route.sourceContract).call())
}

/** `TransferCapExceeded(uint256 requested, uint256 cap)` — the contract's own cap error. */
const TRANSFER_CAP_EXCEEDED = '0xdf1e894a'

/**
 * Turns a revert carrying the contract's cap error into a sentence.
 *
 * The selector is in no public signature database (neither contract is
 * verified), so it is matched by hand here; the two words it carries are the
 * requested amount and the cap that was in force.
 */
export function decodeBridgeRevert(e: any): string | null {
    const blob = [e?.data, e?.error?.data, e?.message, JSON.stringify(e ?? {})]
        .filter((s) => typeof s === 'string')
        .join(' ')
    const i = blob.toLowerCase().indexOf(TRANSFER_CAP_EXCEEDED.slice(2))
    if (i < 0) return null
    const words = blob.slice(i + 8, i + 8 + 128)
    if (!/^[0-9a-fA-F]{128}$/.test(words)) {
        return 'This amount is over the bridge contract’s current per-transfer limit.'
    }
    const cap = BigInt('0x' + words.slice(64))
    const whole = cap / BigInt(10) ** BigInt(ARENA_DECIMALS)
    return `This amount is over the bridge contract’s current per-transfer limit of ${whole.toLocaleString(
        'en-US'
    )} ARENA.`
}

/**
 * Quotes a bridge, returning both the economics and the exact `sendParam` to
 * submit.
 *
 * `minAmountLD` is set to the contract's own `amountReceivedLD` rather than to
 * the requested amount: the two differ whenever dust is truncated, and passing
 * the un-truncated figure would make the contract revert its own slippage
 * check on a transaction that is otherwise perfectly valid.
 *
 * The cap is checked before `quoteOFT` rather than after, because the contract
 * enforces it inside the quote itself — asking first is the difference between
 * a clear message and an unexplained revert.
 */
export async function quoteBridge(
    direction: BridgeDirection,
    recipient: string,
    amountLD: bigint
): Promise<BridgeQuote> {
    const route = getRoute(direction)
    const oft = oftContract(direction)

    const [rate, maxTransferLD] = await Promise.all([
        getDecimalConversionRate(direction),
        getMaxTransferAmount(direction),
    ])

    const flooredLD = floorToConversionRate(amountLD, rate)
    if (flooredLD <= BigInt(0)) {
        throw new Error(
            `Amount is too small to bridge — it rounds to zero at this token's ` +
                `${rate.toString()}-wei step.`
        )
    }
    if (flooredLD > maxTransferLD) {
        const whole = maxTransferLD / BigInt(10) ** BigInt(ARENA_DECIMALS)
        throw new Error(
            `The bridge currently accepts at most ${whole.toLocaleString('en-US')} ARENA ` +
                'per transfer. Send it in smaller amounts.'
        )
    }

    const to = addressToBytes32(recipient)
    const probeParam: SendParam = {
        dstEid: route.dstEid,
        to,
        amountLD: flooredLD.toString(),
        minAmountLD: flooredLD.toString(),
        extraOptions: '0x',
        composeMsg: '0x',
        oftCmd: '0x',
    }

    // Ask the contract what it will actually send/deliver before committing to
    // a minAmountLD, instead of assuming the flooring above is the only
    // adjustment it makes (an OFT may also levy its own fee).
    let oftQuote: any
    try {
        oftQuote = await oft.methods.quoteOFT(probeParam).call()
    } catch (e: any) {
        const decoded = decodeBridgeRevert(e)
        throw decoded ? new Error(decoded) : e
    }
    const amountSentLD = BigInt(oftQuote.oftReceipt.amountSentLD)
    const amountReceivedLD = BigInt(oftQuote.oftReceipt.amountReceivedLD)
    if (amountReceivedLD <= BigInt(0)) {
        throw new Error('The bridge quoted nothing arriving on the other side.')
    }

    const sendParam: SendParam = {
        ...probeParam,
        amountLD: amountSentLD.toString(),
        minAmountLD: amountReceivedLD.toString(),
    }

    const fee = await oft.methods.quoteSend(sendParam, false).call()

    return {
        direction,
        amountSentLD,
        amountReceivedLD,
        nativeFee: BigInt(fee.nativeFee),
        dustLD: amountLD - amountSentLD,
        maxTransferLD,
        sendParam,
    }
}

export interface RawTx {
    to: string
    data: string
    /** Hex wei. Present only on the send, which must carry the LayerZero fee. */
    value?: string
}

/**
 * `approve(sourceContract, amount)` on ARENA.
 *
 * Only the Avalanche leg needs this — that side is an Adapter, which pulls the
 * tokens. Asking for it on the Robinhood leg is a bug, so it throws rather
 * than quietly producing a transaction against a contract that has no
 * allowance to give.
 */
export function buildApproveTx(direction: BridgeDirection, amountLD: bigint): RawTx {
    const route = getRoute(direction)
    if (!route.approvalToken) {
        throw new Error(`The ${route.sourceName} leg does not use an approval.`)
    }
    const web3 = web3For(getSourceNetwork(direction))
    const token = new web3.eth.Contract(ERC20_ABI, route.approvalToken)
    return {
        to: route.approvalToken,
        data: token.methods.approve(route.sourceContract, amountLD.toString()).encodeABI(),
    }
}

/**
 * The bridge transaction itself.
 *
 * `refundAddress` receives any excess native fee back on the source chain —
 * set to the sender.
 */
export function buildSendTx(quote: BridgeQuote, refundAddress: string): RawTx {
    const route = getRoute(quote.direction)
    const web3 = web3For(getSourceNetwork(quote.direction))
    const oft = new web3.eth.Contract(OFT_ABI, route.sourceContract)
    const fee = { nativeFee: quote.nativeFee.toString(), lzTokenFee: '0' }
    return {
        to: route.sourceContract,
        data: oft.methods.send(quote.sendParam, fee, refundAddress).encodeABI(),
        value: '0x' + quote.nativeFee.toString(16),
    }
}

/** LayerZero Scan tracks the cross-chain leg, which no single chain's explorer can show. */
export function layerZeroScanUrl(txHash: string): string {
    return `https://layerzeroscan.com/tx/${txHash}`
}
