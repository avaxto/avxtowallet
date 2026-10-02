/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Wormhole Native Token Transfers (NTT) deployments the bridge can use.
 *
 * NTT moves a token as ITSELF, not as a Wormhole-wrapped copy: the issuer
 * deploys an NTT Manager and a Wormhole Transceiver on every chain. AVXTO is
 * set up hub-and-spoke — Avalanche is the hub, where AVXTO already exists with
 * its fixed supply and is LOCKED when it leaves; every other chain is a spoke
 * with its own AVXTO token that is MINTED on arrival and BURNED on departure.
 * See https://wormhole.com/docs/products/token-transfers/native-token-transfers/overview/
 *
 * **To switch AVXTO bridging on**, deploy with Wormhole's `ntt` CLI and fill in
 * each chain below from its deployment.json: `token` (the token on that chain),
 * `manager` (NttManager) and `transceiver.wormhole` (WormholeTransceiver). A
 * chain is used only once all three are set, so the route to it appears the
 * moment its entry is complete — nothing else needs changing.
 *
 * Until then AVXTO is deliberately NOT offered over the Token Bridge: that
 * would mint an unofficial "Wormhole-wrapped AVXTO" on other chains, a second
 * AVXTO that would compete with the real NTT one once it launches.
 */
import { AVXTO_CONTRACT_ADDRESS, TESTNET_AVXTO_CONTRACT_ADDRESS } from '@/avxto/AVXTOConf'
import type { WormholeNetwork } from './chains'

export interface NttChainDeployment {
    /** The token contract on this chain (the hub's existing token, or the spoke's NTT token). */
    token: string
    /** NttManager address. */
    manager: string
    /** WormholeTransceiver address. */
    transceiver: { wormhole: string }
}

export interface NttTokenDeployment {
    symbol: string
    /** Decimals of the token on the hub. */
    decimals: number
    network: WormholeNetwork
    /** The chain where the token natively lives (locking mode). */
    hubChain: string
    /** By Wormhole chain name. */
    chains: Record<string, NttChainDeployment>
}

const EMPTY = { manager: '', transceiver: { wormhole: '' } }

export const NTT_DEPLOYMENTS: NttTokenDeployment[] = [
    {
        symbol: 'AVXTO',
        decimals: 18,
        network: 'Mainnet',
        hubChain: 'Avalanche',
        chains: {
            // Fill in manager + transceiver after deploying the hub.
            Avalanche: { token: AVXTO_CONTRACT_ADDRESS, ...EMPTY },
            // Spokes, e.g.:
            // Ethereum: { token: '0x…', manager: '0x…', transceiver: { wormhole: '0x…' } },
            // Base: { … }, Arbitrum: { … }, Optimism: { … }, Polygon: { … }, Bsc: { … },
        },
    },
    {
        symbol: 'AVXTO',
        decimals: 18,
        network: 'Testnet',
        hubChain: 'Avalanche',
        chains: {
            // Fuji hub (the testnet AVXTO counterpart, symbol SMTK).
            Avalanche: { token: TESTNET_AVXTO_CONTRACT_ADDRESS, ...EMPTY },
            // Sepolia: { … }, BaseSepolia: { … }, …
        },
    },
]

/** Whether a chain's entry has every address NTT needs. */
export function isDeployed(d: NttChainDeployment | undefined): d is NttChainDeployment {
    return !!d && !!d.token && !!d.manager && !!d.transceiver?.wormhole
}

/** The NTT deployment `token` on `chain` belongs to, deployed or not. */
export function nttDeploymentForToken(
    network: WormholeNetwork,
    chain: string,
    token: string
): NttTokenDeployment | undefined {
    return NTT_DEPLOYMENTS.find(
        (d) => d.network === network && d.chains[chain]?.token.toLowerCase() === token.toLowerCase()
    )
}

/** The SDK's `Ntt.Contracts` for one chain of a deployment. */
export function nttContracts(d: NttTokenDeployment, chain: string) {
    const c = d.chains[chain]
    return { token: c.token, manager: c.manager, transceiver: { wormhole: c.transceiver.wormhole } }
}
