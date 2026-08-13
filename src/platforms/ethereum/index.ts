/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
import { createPlannedPlatform } from '../plannedPlatform'

/**
 * Not yet implemented. Of the planned platforms this is the cheapest to build:
 * the EVM plumbing the C-Chain already uses (web3, Erc20Token, EVMInputDropdown,
 * WalletHelper.sendEth/sendErc20) is chain-id parameterised, so most of the work
 * is decoupling network selection from Avalanche's own network model rather
 * than writing new signing code.
 */
export const ethereumPlatform = createPlannedPlatform({
    id: 'ethereum',
    name: 'Ethereum',
    symbol: 'ETH',
    description: 'Mainnet and L2s — ETH and ERC-20 tokens.',
})

export default ethereumPlatform
