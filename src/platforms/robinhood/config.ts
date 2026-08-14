/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Robinhood Chain network parameters.
 *
 * Source: https://docs.robinhood.com/chain/connecting
 *
 * Robinhood Chain is an Arbitrum Layer-2 on Ethereum, using Ethereum blobs for
 * data availability and **ETH as the native gas token** — so there is no
 * platform-specific gas asset to model, and the whole EVM plumbing the C-Chain
 * already uses (web3, Erc20Token, gas estimation) applies unchanged.
 *
 * Endpoints: the public RPCs are used by default so the wallet works with no
 * configuration. They are rate limited; a user with an Alchemy key can override
 * via the settings screen (see `ROBINHOOD_ALCHEMY_RPC_TEMPLATE`).
 */
import type { PlatformChain, PlatformNetwork } from '../types'

/** EVM chain ids — these are what a signed transaction commits to. */
export const ROBINHOOD_MAINNET_CHAIN_ID = 4663
export const ROBINHOOD_TESTNET_CHAIN_ID = 46630

/**
 * Alchemy endpoints require a per-user API key, so they cannot be shipped as a
 * default. Kept here (rather than in the settings UI) so every Robinhood
 * endpoint lives in one file. `{API_KEY}` is substituted by the caller.
 */
export const ROBINHOOD_ALCHEMY_RPC_TEMPLATE = {
    mainnet: 'https://robinhood-mainnet.g.alchemy.com/v2/{API_KEY}',
    testnet: 'https://robinhood-testnet.g.alchemy.com/v2/{API_KEY}',
    mainnetWs: 'wss://robinhood-mainnet.g.alchemy.com/v2/{API_KEY}',
    testnetWs: 'wss://robinhood-testnet.g.alchemy.com/v2/{API_KEY}',
} as const

export const ROBINHOOD_NETWORKS: PlatformNetwork[] = [
    {
        id: 'mainnet',
        name: 'Robinhood Chain',
        isTestnet: false,
        // Public endpoint (rate limited) — no API key required.
        rpcUrl: 'https://rpc.mainnet.chain.robinhood.com',
        explorerUrl: 'https://robinhoodchain.blockscout.com',
        evmChainId: ROBINHOOD_MAINNET_CHAIN_ID,
        nativeSymbol: 'ETH',
        nativeDecimals: 18,
    },
    {
        id: 'testnet',
        name: 'Robinhood Chain Testnet',
        isTestnet: true,
        rpcUrl: 'https://rpc.testnet.chain.robinhood.com',
        explorerUrl: 'https://explorer.testnet.chain.robinhood.com',
        evmChainId: ROBINHOOD_TESTNET_CHAIN_ID,
        nativeSymbol: 'ETH',
        nativeDecimals: 18,
    },
]

/**
 * A single EVM chain — no X/P equivalent.
 *
 * This is what makes the UI render Robinhood as a plain Ethereum-style wallet:
 * with no `utxo` or `staking` chain present, every cross-chain and staking
 * surface gates itself off without knowing this platform exists.
 */
export const ROBINHOOD_CHAINS: PlatformChain[] = [
    {
        id: 'RH',
        label: 'Robinhood Chain',
        kind: 'evm',
        evmChainId: ROBINHOOD_MAINNET_CHAIN_ID,
    },
]

/** Robinhood's brand accent, used to tint the whole interface and the logo. */
export const ROBINHOOD_ACCENT = 'rgb(204, 255, 0)'

export function getRobinhoodNetwork(id: string): PlatformNetwork | undefined {
    return ROBINHOOD_NETWORKS.find((n) => n.id === id)
}

/** Builds a `{API_KEY}`-substituted Alchemy URL, for the settings override. */
export function buildAlchemyUrl(
    template: keyof typeof ROBINHOOD_ALCHEMY_RPC_TEMPLATE,
    apiKey: string
): string {
    return ROBINHOOD_ALCHEMY_RPC_TEMPLATE[template].replace('{API_KEY}', apiKey)
}
