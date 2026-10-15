/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
*/
/**
 * Sending AVAX from the P-Chain to another P-Chain address, with coin control.
 *
 * Built with @avalanche-sdk/client / @avalabs/avalanchejs (the "Etna-codec"
 * SDK) rather than this app's vendored avalanche.js: P-Chain fees have been
 * dynamic since Etna, and only the SDK prices them. See
 * js/permissionlessDelegate.ts, whose signing paths this reuses.
 *
 * The flow is preview-then-sign on one object: `preparePSend` builds the
 * unsigned transaction (no keys needed — the SDK only wants a public key to
 * derive a default address, and every address here is passed explicitly),
 * the page shows exactly which UTXOs it consumes, the fee and the change,
 * and `signAndIssuePSend` signs that same transaction.
 *
 * Coin control: given `utxos`, the SDK spends only from them, using as few
 * as cover the amount and fee; the preview lists the ones actually used.
 */
import { createAvalancheWalletClient } from '@avalanche-sdk/client'
import { pvm, utils as avaxUtils } from '@avalabs/avalanchejs'
import type { Utxo } from '@avalabs/avalanchejs'
import { BN } from '@/avalanche'
import { activeNetwork } from '@/avalanche-wallet-sdk/Network/network'
import { NODE_MAX_UTXO_ADDRESSES } from '@/helpers/apiLimits'
import { makeChain, sendPViaProvider, signLocallyAndIssueP } from '@/js/permissionlessDelegate'
import { firstOwn, unspendableReason, type CoinRow } from '@/js/coinControl'

/** Any valid compressed secp256k1 key (the curve generator): only used to satisfy the SDK's account check. */
const PLACEHOLDER_PUBKEY = '0x0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'
const PAGE = 1024

const apiBase = () => `${activeNetwork.apiProtocol}://${activeNetwork.apiIp}:${activeNetwork.apiPort}`

/** Every UTXO held by `addresses` on the P-Chain, staked/locked ones included. */
export async function fetchPUtxos(addresses: string[]): Promise<Utxo[]> {
    const api = new pvm.PVMApi(apiBase())
    const bare = Array.from(new Set(addresses.map((a) => (a.startsWith('P-') ? a : `P-${a.replace(/^[XC]-/, '')}`))))
    const out: Utxo[] = []
    const seen = new Set<string>()
    for (let i = 0; i < bare.length; i += NODE_MAX_UTXO_ADDRESSES) {
        const chunk = bare.slice(i, i + NODE_MAX_UTXO_ADDRESSES)
        let startIndex: { address: string; utxo: string } | undefined
        for (;;) {
            const r = await api.getUTXOs({ addresses: chunk, limit: PAGE, startIndex })
            for (const u of r.utxos) {
                const id = u.ID()
                if (!seen.has(id)) {
                    seen.add(id)
                    out.push(u)
                }
            }
            if (r.numFetched < PAGE) break
            startIndex = r.endIndex
        }
    }
    return out
}

const ownerAddresses = (utxo: Utxo, hrp: string): string[] => {
    try {
        return utxo.getOutputOwners().addrs.map((a: any) => avaxUtils.format('P', hrp, a.toBytes()))
    } catch {
        return []
    }
}

/** Picker rows for P-Chain UTXOs, largest first. Staked or stake-locked ones are listed but not pickable. */
export function pCoinRows(utxos: Utxo[], ownAddresses: string[], hrp: string, avaxAssetId: string, now = Date.now() / 1000): CoinRow[] {
    const own = new Set(ownAddresses.map((a) => a.replace(/^[XPC]-/, '')))
    const rows: CoinRow[] = utxos.map((u) => {
        const info = avaxUtils.getUtxoInfo(u)
        const owners = ownerAddresses(u, hrp)
        const locktime = Number(info.locktime)
        const stakeLock = Number(info.stakeableLocktime)
        let reason = unspendableReason(owners, info.threshold, locktime, own, now)
        if (!reason && stakeLock > now) reason = `stake-locked until ${new Date(stakeLock * 1000).toLocaleString()}`
        if (!reason && info.assetId !== avaxAssetId) reason = 'not AVAX'
        return {
            utxoId: u.ID(),
            txId: u.utxoId.txID.toString(),
            outputIdx: u.utxoId.outputIdx.value(),
            assetId: info.assetId,
            amount: new BN(info.amount.toString()),
            owners,
            ownAddress: firstOwn(owners, own),
            threshold: info.threshold,
            locktime: Math.max(locktime, stakeLock),
            spendable: !reason,
            reason,
        }
    })
    rows.sort((a, b) => b.amount.cmp(a.amount))
    return rows
}

export interface PSendParams {
    /** "P-avax1…" or bare "avax1…". */
    to: string
    /** nAVAX. */
    amount: bigint
    memo?: string
    /** Every P address the wallet may spend from. */
    fromAddresses: string[]
    changeAddress: string
    /** Coin control: spend only from these. Omitted = anything at `fromAddresses`. */
    utxos?: Utxo[]
    /** The account's real public key (injected wallets); a placeholder otherwise. */
    publicKey?: string
}

export interface PSendPreview {
    /** The unsigned transaction to sign — exactly what the preview describes. */
    tx: any
    /** Ids of the UTXOs it consumes, largest first, with their amounts (nAVAX). */
    inputs: { utxoId: string; amount: BN }[]
    /** nAVAX. */
    fee: BN
    change: BN
    sending: BN
}

const withPrefix = (a: string) => (a.startsWith('P-') ? a : `P-${a.replace(/^[XC]-/, '')}`)

/** Builds the unsigned transfer and reads back what it spends. Needs no keys. */
export async function preparePSend(p: PSendParams): Promise<PSendPreview> {
    const client = createAvalancheWalletClient({
        chain: makeChain() as any,
        transport: { type: 'http' as const, url: activeNetwork.rpcUrl.c },
        account: {
            xpAccount: { publicKey: p.publicKey || PLACEHOLDER_PUBKEY } as any,
            evmAccount: { address: '0x0000000000000000000000000000000000000000', type: 'json-rpc' },
        } as any,
    })
    const { tx } = await (client as any).pChain.prepareBaseTxn({
        outputs: [{ amount: p.amount, addresses: [withPrefix(p.to)] }],
        fromAddresses: p.fromAddresses.map(withPrefix),
        changeAddresses: [withPrefix(p.changeAddress)],
        ...(p.utxos ? { utxos: p.utxos } : {}),
        ...(p.memo ? { memo: p.memo } : {}),
    })
    return describe(tx, p.amount)
}

/** Inputs, fee and change of a built P-Chain base transaction. */
export function describe(tx: any, sendingAmount: bigint): PSendPreview {
    const inputUtxos: Utxo[] = tx.getInputUtxos()
    const inputs = inputUtxos
        .map((u) => ({ utxoId: u.ID(), amount: new BN(avaxUtils.getUtxoInfo(u).amount.toString()) }))
        .sort((a, b) => b.amount.cmp(a.amount))
    const totalIn = inputs.reduce((s, i) => s.add(i.amount), new BN(0))
    const outputs: any[] = tx.getTx().baseTx.outputs
    const totalOut = outputs.reduce((s, o) => s.add(new BN(o.amount().toString())), new BN(0))
    const sending = new BN(sendingAmount.toString())
    return { tx, inputs, fee: totalIn.sub(totalOut), change: totalOut.sub(sending), sending }
}

/** Signs the previewed transaction locally (mnemonic, private key, Ledger) and issues it. */
export function signAndIssuePLocal(preview: PSendPreview, xpAccounts: unknown[]): Promise<string> {
    return signLocallyAndIssueP(preview.tx, xpAccounts, 'Send on P-Chain')
}

/** Hands the previewed transaction to an injected provider (Core) to sign and submit. */
export function signAndIssuePViaProvider(preview: PSendPreview, provider: unknown): Promise<string> {
    return sendPViaProvider(preview.tx, provider)
}
