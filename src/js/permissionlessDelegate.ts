/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Builds, signs and submits an AddPermissionlessDelegatorTx — the P-Chain
 * delegation transaction format the network currently requires.
 *
 * AbstractWallet.delegate() used to build a legacy AddDelegatorTx via this
 * app's vendored avalanche.js fork (src/avalanche/apis/platformvm), which
 * has no concept of the permissionless format at all (no ADDPERMISSIONLESS-
 * DELEGATORTX constant, nothing). That legacy tx type is no longer
 * parseable by the node ("no parser found for tx"), so delegation is
 * rebuilt here on @avalanche-sdk/client / @avalabs/avalanchejs instead —
 * the same "Etna-codec" SDK InjectedWallet.ts already uses for X/P/C
 * atomic imports and exports, for the identical reason.
 *
 * Two submit paths, matching the two ways this app can produce a signature:
 *   - delegatePermissionlessViaProvider(): hands off to an injected
 *     provider (Core) via avalanche_signTransaction/avalanche_sendTransaction,
 *     mirroring InjectedWallet's existing import/export calls exactly.
 *   - delegatePermissionlessLocal(): signs with an XPAccount that already
 *     holds (or can reach) the private key — a plain private-key account
 *     for Mnemonic/Singleton, or a hardware-backed one for Ledger (see
 *     LedgerWallet.getXPAccountForDelegation()).
 *
 * Deliberately restricted to a SINGLE signing address (fromAddress /
 * changeAddress / rewardAddress are singular, not arrays): the SDK's local
 * signing path (signXPTransaction) only ever signs with the one XPAccount
 * given to it, so a transaction whose inputs span multiple HD-derived
 * addresses would end up with un-signed credential slots and get rejected
 * by the node. Every caller here passes the wallet's primary P-chain
 * address for all three roles, same as InjectedWallet already does
 * elsewhere in this codebase for the same reason.
 */
import { createAvalancheWalletClient } from '@avalanche-sdk/client'
import { defineChain } from 'viem'
import { BN } from '@/avalanche'
import { activeNetwork } from '@/avalanche-wallet-sdk/Network/network'

export interface DelegatePermissionlessParams {
    nodeID: string
    /** Amount to stake, in nanoAVAX (this app's usual BN denomination). */
    amount: BN
    end: Date
    fromAddress: string
    changeAddress: string
    rewardAddress: string
}

export interface DelegatePermissionlessProviderParams extends DelegatePermissionlessParams {
    /** 0x-prefixed EVM address, needed only to satisfy the build client's account check below. */
    evmAddress: `0x${string}`
}

function makeChain() {
    return defineChain({
        id: activeNetwork.evmChainID,
        name: 'Avalanche',
        nativeCurrency: { name: 'Avalanche', symbol: 'AVAX', decimals: 18 },
        rpcUrls: { default: { http: [activeNetwork.rpcUrl.c] } },
    })
}

async function prepareTx(buildClient: any, params: DelegatePermissionlessParams) {
    return buildClient.pChain.prepareAddPermissionlessDelegatorTxn({
        nodeId: params.nodeID,
        stakeInAvax: BigInt(params.amount.toString()),
        end: BigInt(Math.floor(params.end.getTime() / 1000)),
        rewardAddresses: [params.rewardAddress],
        fromAddresses: [params.fromAddress],
        changeAddresses: [params.changeAddress],
    })
}

/**
 * Builds over plain HTTP, then signs + submits through a custom-transport
 * client wired to the injected provider — the exact pattern
 * InjectedWallet.exportFromCChain/importToXChain already use.
 */
export async function delegatePermissionlessViaProvider(
    params: DelegatePermissionlessProviderParams,
    provider: any
): Promise<string> {
    const chain = makeChain() as any

    // Pre-fetch the account's pubkey so the HTTP build client can satisfy its
    // internal account check without calling avalanche_getAccountPubKey on
    // the node itself — the node doesn't implement that method ("method
    // does not exist"), only the injected provider does. Same fix
    // InjectedWallet.importToXChain/importToPlatformChain already apply.
    const pubKeyData = (await provider.request({
        method: 'avalanche_getAccountPubKey',
        params: {},
    })) as { xp: string; evm: string }

    const buildClient = createAvalancheWalletClient({
        chain,
        transport: { type: 'http' as const, url: activeNetwork.rpcUrl.c },
        account: {
            xpAccount: { publicKey: pubKeyData.xp } as any,
            evmAccount: {
                address: params.evmAddress,
                publicKey: pubKeyData.evm,
            } as any,
        } as any,
    })
    const { tx } = await prepareTx(buildClient, params)

    const signClient = createAvalancheWalletClient({
        chain,
        transport: { type: 'custom' as const, provider },
    })
    const result = await signClient.sendXPTransaction({ tx, chainAlias: 'P' } as any)
    return (result as any).txHash
}

/**
 * Builds, signs and submits against a single HTTP client whose `account` is
 * a local XPAccount — the account's `signTransaction` supplies the
 * signature (locally for a private-key account, or via a hardware device
 * for a Ledger-backed one), so there's no injected-provider round trip.
 */
export async function delegatePermissionlessLocal(
    params: DelegatePermissionlessParams,
    xpAccount: unknown
): Promise<string> {
    const chain = makeChain() as any

    const client = createAvalancheWalletClient({
        chain,
        transport: { type: 'http' as const, url: activeNetwork.rpcUrl.c },
        // evmAccount is required by AvalancheAccount's type but never touched
        // by the P-chain-only calls below (prepare*/sendXPTransaction read
        // only .xpAccount) — omitting it is fine at runtime.
        account: { xpAccount } as any,
    })

    const { tx } = await prepareTx(client, params)
    const result = await client.sendXPTransaction({ tx, chainAlias: 'P' } as any)
    return (result as any).txHash
}
