/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/** Recipient address validation, by the destination chain's kind. */
import { isValidSolanaAddress } from '@/solana/keys'
import { isValidBitcoinAddress } from '@/bitcoin/keys'
import { getBitcoinNetworkById } from '@/bitcoin/networks'
import type { BridgeChain } from './types'

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/

/** '' when `address` can receive on `chain`, otherwise why not. */
export function recipientError(chain: BridgeChain, address: string): string {
    const a = address.trim()
    if (!a) return `Enter the ${chain.name} address to receive at.`
    if (chain.kind === 'evm') return EVM_ADDRESS.test(a) ? '' : `Not a valid ${chain.name} address (0x…).`
    if (chain.kind === 'solana') return isValidSolanaAddress(a) ? '' : 'Not a valid Solana address.'
    const network = getBitcoinNetworkById(chain.networkId ?? '')
    return network && isValidBitcoinAddress(a, network) ? '' : `Not a valid ${chain.name} address.`
}
