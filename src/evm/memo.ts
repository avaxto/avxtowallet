/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Free-text memos on a native-asset EVM send.
 *
 * Only makes sense for a native transfer: an ERC-20/NFT send's `data` field
 * is already the call itself (`transfer(...)`, `transferFrom(...)`), and
 * overwriting it with memo bytes would corrupt the call and revert. A plain
 * value transfer to an EOA has no reason to carry any `data` at all, so it is
 * free to use for this.
 *
 * Encoding is UTF-8 -> base64 -> the base64 string's own bytes, hex-encoded
 * for the transaction's `data` field — not the memo's raw UTF-8 bytes
 * directly. That is a deliberate two-step: it is what was asked for, and it
 * also means the memo is unambiguous to decode later regardless of what
 * bytes the text itself contained (multi-byte UTF-8, embedded control
 * characters, …) — the outer layer is always plain base64 alphabet.
 */
import { Buffer } from '@/avalanche'

/** Turns UTF-8 memo text into the `0x`-prefixed hex bytes an EVM tx's `data` field carries. */
export function encodeMemoToTxData(memo: string): string {
    const base64 = Buffer.from(memo, 'utf8').toString('base64')
    return '0x' + Buffer.from(base64, 'utf8').toString('hex')
}

/**
 * The intrinsic gas EIP-2028 charges for `data` on top of the 21000 base cost
 * of a value transfer: 16 gas per non-zero byte, 4 gas per zero byte.
 *
 * This is exact, not an estimate — the EVM's intrinsic-gas formula is fixed
 * for a given byte sequence, unlike `eth_estimateGas` against a contract call,
 * which depends on execution and current state. So callers should not pad
 * this the way they pad a contract-call estimate; the fixed 21000 base plus
 * this number is the precise minimum the network will accept, and base64
 * output (this module's own encoding) never contains a zero byte in
 * practice, so it always charges the full 16 gas/byte rate.
 */
export function intrinsicGasForData(data: string): number {
    const hex = data.startsWith('0x') ? data.slice(2) : data
    let gas = 0
    for (let i = 0; i < hex.length; i += 2) {
        gas += hex.slice(i, i + 2) === '00' ? 4 : 16
    }
    return gas
}
