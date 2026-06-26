/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Network utility functions for checking mainnet and testnet network IDs
 */

/**
 * Check if a network ID corresponds to Avalanche Mainnet
 * @param networkId The network ID to check
 * @returns true if the network ID is for mainnet
 */
export function isMainnetNetworkID(networkId: number): boolean {
    return networkId === 1
}

/**
 * Check if a network ID corresponds to Avalanche Testnet (Fuji)
 * @param networkId The network ID to check
 * @returns true if the network ID is for testnet
 */
export function isTestnetNetworkID(networkId: number): boolean {
    return networkId === 5
}
