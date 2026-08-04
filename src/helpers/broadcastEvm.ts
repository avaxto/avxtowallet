/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
import { web3 } from '@/evm'
import { Buffer as BufferAvalanche } from '@/avalanche'
import { pinia } from '@/stores/pinia'
import { useOfflineSigningStore } from '@/stores/offlineSigning'

/**
 * Submits a signed EVM (C-chain) transaction, or captures it when offline
 * signing is active.
 *
 * EVM transactions are a different family from the X/P/C atomic transactions
 * in issueTx.ts: they are ethereumjs transactions submitted through
 * eth_sendRawTransaction, not through cChain.issueTx. Keeping this as the one
 * entry point means every C-chain send, swap, approval and contract deploy
 * shares the same offline-signing behaviour.
 *
 * @param serializedHex Signed transaction bytes as hex, with or without `0x`.
 * @param label Human description used in the offline export list.
 * @returns The transaction hash, or the offline sentinel id when captured.
 */
export async function broadcastEvm(serializedHex: string, label = 'C-Chain transaction'): Promise<string> {
    const hex = serializedHex.startsWith('0x') ? serializedHex.slice(2) : serializedHex

    const offline = useOfflineSigningStore(pinia)
    if (offline.isActive) {
        return offline.capture({
            label,
            family: 'evm',
            chain: 'C',
            base64: BufferAvalanche.from(hex, 'hex').toString('base64'),
        })
    }

    const receipt = await web3.eth.sendSignedTransaction('0x' + hex)
    return receipt.transactionHash as string
}
