/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * ARENA bridge: Avalanche C-Chain -> Robinhood Chain, via LayerZero V2 OFT.
 *
 * Verified directly against the live contracts:
 *
 *   - `0xA59Ad32d…F86f7` on Avalanche is an **OFT Adapter** (LayerZero V2):
 *     `token()` returns the ARENA ERC-20, `approvalRequired()` is true, and
 *     `oftVersion()` reports interface 0x02e49c2c / version 1.
 *   - `peers(30416)` on that adapter returns ARENA's Robinhood address, which
 *     is what proves **30416 is Robinhood Chain's LayerZero endpoint id**.
 *   - The send call used here is exactly
 *     `send((uint32,bytes32,uint256,uint256,bytes,bytes,bytes),(uint256,uint256),address)`
 *     with `msg.value` equal to the quoted `nativeFee`, and empty
 *     extraOptions/composeMsg/oftCmd (the adapter carries enforced options, so
 *     none need to be supplied here).
 *
 * The one behaviour that is easy to miss and expensive to get wrong:
 * `sharedDecimals()` is **6** while ARENA is an 18-decimal token, giving a
 * `decimalConversionRate()` of 1e12. Any amount that is not a whole multiple
 * of 1e12 is silently truncated by the contract — the remainder is simply not
 * bridged. So amounts are floored here, deliberately and visibly, rather than
 * letting a user request a number the protocol will quietly round down.
 */
import type { EvmNetwork } from '../networkRegistry'
import { getEvmNetworkByChainId } from '../networkRegistry'
import { web3For } from '../providers'

/** ARENA ERC-20 on Avalanche C-Chain — the token actually being locked. */
export const ARENA_TOKEN_AVALANCHE = '0xB8d7710f7d8349A506b75dD184F05777c82dAd0C'

/** ARENA on Robinhood Chain — the OFT that mints on arrival. */
export const ARENA_TOKEN_ROBINHOOD = '0x50832d74a7160e2f7d361f5e678e107d228b9aa6'

/** The LayerZero V2 OFT Adapter that locks ARENA on Avalanche. */
export const ARENA_OFT_ADAPTER = '0xA59Ad32dAd425250ca3601F964d92611818F86f7'

/**
 * Robinhood Chain's LayerZero V2 endpoint id.
 *
 * Not a chain id — LayerZero keeps its own address space (mainnet ids are
 * 30xxx). Confirmed by `peers(30416)` on the adapter resolving to ARENA's
 * Robinhood contract.
 */
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
    /** What the contract will actually pull, after dust truncation. */
    amountSentLD: bigint
    /** What lands on Robinhood Chain. */
    amountReceivedLD: bigint
    /** Native AVAX required as `msg.value`. */
    nativeFee: bigint
    /** Amount lost to the 6-shared-decimals truncation, if any. */
    dustLD: bigint
    /** The exact params the send must be issued with, so quote and send cannot drift. */
    sendParam: SendParam
}

/** The Avalanche C-Chain registry entry — the chain everything here is read from and signed on. */
export function getAvalancheNetwork(): EvmNetwork {
    const net = getEvmNetworkByChainId(AVALANCHE_CHAIN_ID)
    if (!net) throw new Error('Avalanche C-Chain is missing from the EVM network registry.')
    return net
}

/** An EVM address as the left-padded bytes32 LayerZero addresses its recipients by. */
export function addressToBytes32(address: string): string {
    const clean = address.toLowerCase().replace(/^0x/, '')
    if (!/^[0-9a-f]{40}$/.test(clean)) throw new Error(`Invalid address: ${address}`)
    return '0x' + clean.padStart(64, '0')
}

/**
 * The adapter's local->shared decimal step (1e12 here).
 *
 * Read from the contract rather than hardcoded: it is the single number that
 * decides how much of a user's amount is silently discarded, and a wrong
 * assumption is invisible until funds go missing.
 */
export async function getDecimalConversionRate(): Promise<bigint> {
    const web3 = web3For(getAvalancheNetwork())
    const oft = new web3.eth.Contract(OFT_ABI, ARENA_OFT_ADAPTER)
    const rate: string = await oft.methods.decimalConversionRate().call()
    return BigInt(rate)
}

/** Floors to a whole multiple of `rate` — what the contract would do anyway, made explicit. */
export function floorToConversionRate(amountLD: bigint, rate: bigint): bigint {
    if (rate <= BigInt(1)) return amountLD
    return (amountLD / rate) * rate
}

export async function getArenaBalance(owner: string): Promise<bigint> {
    const web3 = web3For(getAvalancheNetwork())
    const token = new web3.eth.Contract(ERC20_ABI, ARENA_TOKEN_AVALANCHE)
    return BigInt(await token.methods.balanceOf(owner).call())
}

/** How much ARENA the adapter is currently allowed to pull. */
export async function getArenaAllowance(owner: string): Promise<bigint> {
    const web3 = web3For(getAvalancheNetwork())
    const token = new web3.eth.Contract(ERC20_ABI, ARENA_TOKEN_AVALANCHE)
    return BigInt(await token.methods.allowance(owner, ARENA_OFT_ADAPTER).call())
}

/**
 * Quotes a bridge, returning both the economics and the exact `sendParam` to
 * submit.
 *
 * `minAmountLD` is set to the contract's own `amountReceivedLD` rather than to
 * the requested amount: the two differ whenever dust is truncated, and passing
 * the un-truncated figure would make the adapter revert its own slippage check
 * on a transaction that is otherwise perfectly valid.
 */
export async function quoteBridge(recipient: string, amountLD: bigint): Promise<BridgeQuote> {
    const web3 = web3For(getAvalancheNetwork())
    const oft = new web3.eth.Contract(OFT_ABI, ARENA_OFT_ADAPTER)

    const rate = await getDecimalConversionRate()
    const flooredLD = floorToConversionRate(amountLD, rate)
    if (flooredLD <= BigInt(0)) {
        throw new Error(
            `Amount is too small to bridge — it rounds to zero at this token's ` +
                `${rate.toString()}-wei step.`
        )
    }

    const to = addressToBytes32(recipient)
    const probeParam: SendParam = {
        dstEid: ROBINHOOD_LZ_EID,
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
    const oftQuote = await oft.methods.quoteOFT(probeParam).call()
    const amountSentLD = BigInt(oftQuote.oftReceipt.amountSentLD)
    const amountReceivedLD = BigInt(oftQuote.oftReceipt.amountReceivedLD)

    const sendParam: SendParam = {
        ...probeParam,
        amountLD: amountSentLD.toString(),
        minAmountLD: amountReceivedLD.toString(),
    }

    const fee = await oft.methods.quoteSend(sendParam, false).call()

    return {
        amountSentLD,
        amountReceivedLD,
        nativeFee: BigInt(fee.nativeFee),
        dustLD: amountLD - amountSentLD,
        sendParam,
    }
}

export interface RawTx {
    to: string
    data: string
    /** Hex wei. Present only on the send, which must carry the LayerZero fee. */
    value?: string
}

/** `approve(adapter, amount)` on ARENA — required, since this is an Adapter, not a native OFT. */
export function buildApproveTx(amountLD: bigint): RawTx {
    const web3 = web3For(getAvalancheNetwork())
    const token = new web3.eth.Contract(ERC20_ABI, ARENA_TOKEN_AVALANCHE)
    return {
        to: ARENA_TOKEN_AVALANCHE,
        data: token.methods.approve(ARENA_OFT_ADAPTER, amountLD.toString()).encodeABI(),
    }
}

/**
 * The bridge transaction itself.
 *
 * `refundAddress` receives any excess native fee back on the source chain —
 * set to the sender.
 */
export function buildSendTx(quote: BridgeQuote, refundAddress: string): RawTx {
    const web3 = web3For(getAvalancheNetwork())
    const oft = new web3.eth.Contract(OFT_ABI, ARENA_OFT_ADAPTER)
    const fee = { nativeFee: quote.nativeFee.toString(), lzTokenFee: '0' }
    return {
        to: ARENA_OFT_ADAPTER,
        data: oft.methods.send(quote.sendParam, fee, refundAddress).encodeABI(),
        value: '0x' + quote.nativeFee.toString(16),
    }
}

/** LayerZero Scan tracks the cross-chain leg, which no single chain's explorer can show. */
export function layerZeroScanUrl(txHash: string): string {
    return `https://layerzeroscan.com/tx/${txHash}`
}
