/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * The gas limit for sending the native asset (AVAX on the C-Chain).
 *
 * 21000 only covers a transfer to an ordinary address (an EOA). A contract
 * recipient — a multisig, a smart-contract wallet, an exchange's deposit
 * proxy — runs code on receipt, and a 21000 limit makes that transaction
 * revert out of gas while still charging the fee. So the recipient is looked
 * at first: no code means the exact 21000 (+ memo bytes, see evm/memo.ts);
 * code means the node's estimate with the same 20% headroom contract calls get
 * elsewhere (evm/signer.ts estimateGasWith). A contract the node says would
 * revert is refused outright instead of falling back to 21000, which would be
 * a guaranteed failure.
 */
import type Web3 from 'web3'
import { intrinsicGasForData } from './memo'

const TRANSFER_GAS = 21_000

/** Thrown when a dry run of the transfer to a contract recipient fails. */
export class ContractRejectsTransferError extends Error {
    constructor(public readonly to: string, reason?: string) {
        super(
            `${to} is a smart contract, and a dry run of this transfer to it failed` +
                (reason ? ` (${reason})` : '') +
                '. Nothing was sent. Check that this contract is meant to receive AVAX directly.'
        )
        this.name = 'ContractRejectsTransferError'
    }
}

export async function nativeTransferGasLimit(
    web3: Web3,
    from: string,
    to: string,
    valueWei: { toString(): string },
    data?: string
): Promise<number> {
    const plain = TRANSFER_GAS + (data ? intrinsicGasForData(data) : 0)
    const code = await web3.eth.getCode(to)
    if (!code || code === '0x' || code === '0x0') return plain

    let estimate: number
    try {
        estimate = Number(
            await web3.eth.estimateGas({
                from,
                to,
                value: valueWei.toString(),
                ...(data ? { data } : {}),
            })
        )
    } catch (e: any) {
        throw new ContractRejectsTransferError(to, e?.message)
    }
    return Math.max(plain, Math.ceil(estimate * 1.2))
}
