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
 *
 *   - delegatePermissionlessViaProvider(): hands off to an injected
 *     provider (Core) via avalanche_signTransaction/avalanche_sendTransaction,
 *     mirroring InjectedWallet's existing import/export calls exactly.
 *     Restricted to ONE from/change address — a real, external constraint:
 *     Core's avalanche_signTransaction only ever signs for the account's
 *     primary (m/0/0) address, never HD-derived children, regardless of how
 *     the transaction is built (established elsewhere in this codebase).
 *
 *   - delegatePermissionlessLocal(): signs with XPAccounts this app already
 *     holds (or can reach) the private keys for — plain private-key
 *     accounts for Mnemonic/Singleton, one per candidate HD address. No
 *     such external constraint applies here: the wallet can derive/sign for
 *     any of its own addresses, so this builds against every address that
 *     might hold stakeable AVAX (fromAddresses, plural) rather than just
 *     one, and signs with every candidate key — see its docstring for how
 *     that stays safe with only one signature per credential slot.
 *
 * Both pin the CHANGE and REWARD address to a single caller-supplied
 * address regardless (see AbstractWallet.delegate() — always index 0), only
 * the SPEND side (fromAddress/fromAddresses) differs between the two paths.
 */
import { createAvalancheWalletClient } from '@avalanche-sdk/client'
import { utils as avaxUtils } from '@avalabs/avalanchejs'
import { defineChain } from 'viem'
import { BN, Buffer as BufferAvalanche } from '@/avalanche'
import { activeNetwork } from '@/avalanche-wallet-sdk/Network/network'
import { pChain } from '@/AVA'
import { pinia } from '@/stores/pinia'
import { useOfflineSigningStore } from '@/stores/offlineSigning'

export interface DelegatePermissionlessParamsBase {
    nodeID: string
    /** Amount to stake, in nanoAVAX (this app's usual BN denomination). */
    amount: BN
    end: Date
    changeAddress: string
    rewardAddress: string
    /**
     * Optional: stake only these UTXOs (@avalabs/avalanchejs objects — see
     * pChainSend.sdkUtxosFor). Omitted, the SDK spends what fromAddresses hold.
     */
    utxos?: unknown[]
}

/** An AddPermissionlessValidatorTx's extra fields (ACP-62). */
export interface ValidatePermissionlessExtra {
    /** % of delegators' rewards the validator keeps: 2–100, up to 3 decimals. */
    delegationFee: number
    /** The node's BLS public key and proof of possession, 0x hex (info.getNodeID → nodePOP). */
    blsPublicKey: string
    blsSignature: string
}

export interface DelegatePermissionlessProviderParams extends DelegatePermissionlessParamsBase {
    fromAddress: string
    /** 0x-prefixed EVM address, needed only to satisfy the build client's account check below. */
    evmAddress: `0x${string}`
}

export interface DelegatePermissionlessLocalParams extends DelegatePermissionlessParamsBase {
    /** Every address the wallet might hold stakeable AVAX at — see file docstring. */
    fromAddresses: string[]
}

export function makeChain() {
    return defineChain({
        id: activeNetwork.evmChainID,
        name: 'Avalanche',
        nativeCurrency: { name: 'Avalanche', symbol: 'AVAX', decimals: 18 },
        rpcUrls: { default: { http: [activeNetwork.rpcUrl.c] } },
    })
}

// Note on units: despite its name, the SDK's `stakeInAvax` is passed straight
// through as the transaction's `weight`, which is in nAVAX (checked against
// @avalanche-sdk/client 0.1.1's builder; later SDK versions rename it
// `stakeInNanoAvax`). Start times aren't sent: since Durango a stake starts
// when the P-Chain accepts it (the SDK sets start = 0).
async function prepareTx(
    buildClient: any,
    params: DelegatePermissionlessParamsBase & { fromAddresses: string[] }
) {
    return buildClient.pChain.prepareAddPermissionlessDelegatorTxn({
        nodeId: params.nodeID,
        stakeInAvax: BigInt(params.amount.toString()),
        end: BigInt(Math.floor(params.end.getTime() / 1000)),
        rewardAddresses: [params.rewardAddress],
        fromAddresses: params.fromAddresses,
        changeAddresses: [params.changeAddress],
        ...(params.utxos ? { utxos: params.utxos } : {}),
    })
}

/** AddPermissionlessValidatorTx on the Primary Network (ACP-62): the only way to add a validator since Durango. */
async function prepareValidatorTx(
    buildClient: any,
    params: DelegatePermissionlessParamsBase & ValidatePermissionlessExtra & { fromAddresses: string[] }
) {
    return buildClient.pChain.prepareAddPermissionlessValidatorTxn({
        nodeId: params.nodeID,
        stakeInAvax: BigInt(params.amount.toString()),
        end: BigInt(Math.floor(params.end.getTime() / 1000)),
        rewardAddresses: [params.rewardAddress],
        delegatorRewardAddresses: [params.rewardAddress],
        delegatorRewardPercentage: params.delegationFee,
        publicKey: params.blsPublicKey,
        signature: params.blsSignature,
        fromAddresses: params.fromAddresses,
        changeAddresses: [params.changeAddress],
        ...(params.utxos ? { utxos: params.utxos } : {}),
    })
}

/** A build client for local signing: the account is only there for the SDK's presence check. */
function localBuildClient(xpAccount: unknown) {
    return createAvalancheWalletClient({
        chain: makeChain() as any,
        transport: { type: 'http' as const, url: activeNetwork.rpcUrl.c },
        account: {
            xpAccount,
            evmAccount: { address: '0x0000000000000000000000000000000000000000', type: 'json-rpc' },
        } as any,
    })
}

/** A build client carrying an injected provider's real public keys (it can't answer avalanche_getAccountPubKey over HTTP). */
async function providerBuildClient(provider: any, evmAddress: `0x${string}`) {
    const pubKeyData = (await provider.request({ method: 'avalanche_getAccountPubKey', params: {} })) as { xp: string; evm: string }
    return createAvalancheWalletClient({
        chain: makeChain() as any,
        transport: { type: 'http' as const, url: activeNetwork.rpcUrl.c },
        account: {
            xpAccount: { publicKey: pubKeyData.xp } as any,
            evmAccount: { address: evmAddress, publicKey: pubKeyData.evm } as any,
        } as any,
    })
}

/** Adds a Primary Network validator, signed with this wallet's own keys (see delegatePermissionlessLocal). */
export async function validatePermissionlessLocal(
    params: DelegatePermissionlessLocalParams & ValidatePermissionlessExtra,
    xpAccounts: unknown[]
): Promise<string> {
    if (xpAccounts.length === 0) throw new Error('No signing key available to add a validator.')
    if (params.fromAddresses.length === 0) throw new Error('No P-chain address available to stake from.')
    const { tx } = await prepareValidatorTx(localBuildClient(xpAccounts[0]), params)
    return signLocallyAndIssueP(tx, xpAccounts, 'Add a validator', 'The stake')
}

/** Adds a Primary Network validator, signed and submitted by an injected provider (Core). */
export async function validatePermissionlessViaProvider(
    params: DelegatePermissionlessProviderParams & ValidatePermissionlessExtra,
    provider: any
): Promise<string> {
    const client = await providerBuildClient(provider, params.evmAddress)
    const { tx } = await prepareValidatorTx(client, { ...params, fromAddresses: [params.fromAddress] })
    return sendPViaProvider(tx, provider)
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
    const { tx } = await prepareTx(buildClient, { ...params, fromAddresses: [params.fromAddress] })
    return sendPViaProvider(tx, provider)
}

/** Signs and submits an unsigned P-chain tx through an injected provider (Core). */
export async function sendPViaProvider(tx: unknown, provider: any): Promise<string> {
    const signClient = createAvalancheWalletClient({
        chain: makeChain() as any,
        transport: { type: 'custom' as const, provider },
    })
    const result = await signClient.sendXPTransaction({ tx, chainAlias: 'P' } as any)
    return (result as any).txHash
}

/**
 * Builds against every candidate address, then signs with every candidate
 * key in turn.
 *
 * The SDK's own one-call signing path (signXPTransaction/sendXPTransaction)
 * only ever produces one signature, from one XPAccount — fine for a
 * single-address transaction, but a transaction whose inputs are spread
 * across several HD-derived addresses needs a matching signature per
 * address. So this drops to the lower-level pieces instead: build the tx
 * with @avalabs/avalanchejs's own UnsignedTx.addSignature(), once per
 * candidate account.
 *
 * addSignature() recovers the signing pubkey from the signature itself and
 * only fills credential slots that pubkey actually owns — signing with a
 * key that doesn't own any input in this particular transaction is a safe
 * no-op, not an error. So candidates don't need to be pre-filtered to
 * "addresses that actually have UTXOs here": sign with all of them, then
 * check hasAllSignatures() once at the end.
 *
 * Respects offline signing itself (the SDK path this bypasses doesn't go
 * through issueP(), which is where that's normally handled) so the
 * "sign only" toggle still works for delegation.
 */
export async function delegatePermissionlessLocal(
    params: DelegatePermissionlessLocalParams,
    xpAccounts: unknown[]
): Promise<string> {
    if (xpAccounts.length === 0) {
        throw new Error('No signing key available for delegation.')
    }
    if (params.fromAddresses.length === 0) {
        throw new Error('No P-chain address available to delegate from.')
    }

    const chain = makeChain() as any

    const client = createAvalancheWalletClient({
        chain,
        transport: { type: 'http' as const, url: activeNetwork.rpcUrl.c },
        // evmAccount's CONTENTS are never read for a P-chain-only build (its
        // fields only matter for C-chain calls) — but its mere PRESENCE is
        // load-bearing: getBech32AddressFromAccountOrClient (called
        // internally while building the tx) falls back to
        // avalanche_getAccountPubKey whenever either account is missing,
        // and that RPC method doesn't exist on a plain HTTP transport
        // ("method does not exist"). A placeholder satisfies the presence
        // check without ever being inspected. The xpAccount here is
        // likewise only for that same presence check — actual signing below
        // uses every candidate account individually, not this one.
        account: {
            xpAccount: xpAccounts[0],
            evmAccount: { address: '0x0000000000000000000000000000000000000000', type: 'json-rpc' },
        } as any,
    })

    const { tx } = await prepareTx(client, params)
    return signLocallyAndIssueP(tx, xpAccounts, 'Delegate stake', 'The stake')
}

/**
 * Signs an unsigned P-chain tx with every candidate key (see
 * delegatePermissionlessLocal for why every one), then issues it — or, with
 * "sign only" on, captures it for export instead. `what` names the funds in
 * the error when a signature is missing.
 */
export async function signLocallyAndIssueP(tx: any, xpAccounts: unknown[], label: string, what = 'The funds'): Promise<string> {
    if (xpAccounts.length === 0) throw new Error('No signing key available.')
    for (const xpAccount of xpAccounts) {
        const sigHex: string = await (xpAccount as any).signTransaction(tx.toBytes())
        tx.addSignature(avaxUtils.hexToBuffer(sigHex))
    }

    if (!tx.hasAllSignatures()) {
        throw new Error(
            `Could not produce a signature for every input. ${what} may be spread across ` +
                'more addresses than this wallet can sign for — try again after a balance refresh.'
        )
    }

    const signedBytes: Uint8Array = tx.getSignedTx().toBytes()

    // Mirror issueP()'s offline-signing capture (helpers/issueTx.ts) — this
    // path bypasses issueP() entirely (it submits via the SDK client, not
    // our vendored Tx classes), so without this the "sign only" toggle
    // would silently stop applying to delegation.
    const offline = useOfflineSigningStore(pinia)
    if (offline.isActive) {
        return offline.capture({
            label,
            family: 'avalanche',
            chain: 'P',
            base64: BufferAvalanche.from(signedBytes).toString('base64'),
        })
    }

    const hex = avaxUtils.bufferToHex(avaxUtils.addChecksum(signedBytes)) as `0x${string}`
    return await pChain.issueTx(hex)
}
