/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * BTC ↔ BTC.b through Lombard — what Core uses as the Avalanche Bridge for
 * Bitcoin today. 
 *
 * Bitcoin → BTC.b (deposit):
 *  1. The C-Chain account signs the plain text "destination chain id is 43114"
 *     (`personal_sign`) — verified: the captured signature recovers to the
 *     user's C-Chain address.
 *  2. Lombard's API turns that into a personal Bitcoin deposit address
 *     (POST api/v1/address/generate; an existing one is reused).
 *  3. An ordinary Bitcoin payment to that address. Lombard mints BTC.b 1:1 to
 *     the C-Chain account once its notarization completes — no claim needed.
 *     Minimum 0.0002 BTC.
 *
 * BTC.b → Bitcoin (redeem):
 *  1. Approve the BTC.b adapter for exactly the amount.
 *  2. `redeemForBtc(owner, adapter, scriptPubKey, amount)` on the router the
 *     adapter names. BTC is paid to any Bitcoin address, minus the router's
 *     commission (read live; 10,000 sats when checked).
 *
 * Everything else (status, fees, minimums) is read from Lombard's API or the
 * contracts at the moment it is needed.
 */
import axios from 'axios'
import Web3 from 'web3'
import * as bitcoin from 'bitcoinjs-lib'

import { BN } from '@/avalanche'
import type { EvmSigner } from '@/evm/signer'
import { isOfflineTxId } from '@/stores/offlineSigning'
import type { BitcoinNetwork } from '@/bitcoin/networks'

export const LOMBARD_API = 'https://mainnet.prod.lombard.finance'
/** BTC.b on Avalanche C-Chain (8 decimals). */
export const BTCB = '0x152b9d0FdC40C096757F570A51E494bd4b943E50'
export const BTCB_DECIMALS = 8
/** Lombard's BTC.b adapter on Avalanche: the deposit target and the redeem spender. */
export const BTCB_ADAPTER = '0x85D1D52e11290F174444d21C2a167bEDBE36e4d2'
export const AVALANCHE_DESTINATION = 'DESTINATION_BLOCKCHAIN_AVALANCHE'
export const AVALANCHE_CHAIN_ID = 43114
/** Lombard's minimum Bitcoin deposit (0.0002 BTC). */
export const MIN_DEPOSIT_SATS = 20_000
const TIMEOUT_MS = 20_000
const APPROVE_GAS = 80_000
const REDEEM_GAS = 250_000

export function destinationMessage(chainId = AVALANCHE_CHAIN_ID): string {
    return `destination chain id is ${chainId}`
}

const api = () => axios.create({ baseURL: LOMBARD_API, timeout: TIMEOUT_MS })

/** The C-Chain account's existing BTC.b deposit address, if Lombard already issued one. */
export async function existingDepositAddress(evmAddress: string): Promise<string | null> {
    const { data } = await api().get(`/api/v1/address/destination/${AVALANCHE_DESTINATION}/${evmAddress}`, { params: { asc: false } })
    const hit = (Array.isArray(data?.addresses) ? data.addresses : []).find(
        (a: any) =>
            a?.type === 'ADDRESS_TYPE_DEPOSIT' &&
            String(a?.deposit_metadata?.to_address ?? '').toLowerCase() === evmAddress.toLowerCase() &&
            String(a?.deposit_metadata?.token_address ?? '').toLowerCase() === BTCB_ADAPTER.toLowerCase() &&
            a?.deposit_metadata?.to_blockchain === AVALANCHE_DESTINATION
    )
    return hit ? String(hit.btc_address) : null
}

/** Asks Lombard for a deposit address; `signature` is the C-Chain account's `personal_sign` of `destinationMessage()`. */
export async function generateDepositAddress(evmAddress: string, signature: string): Promise<string> {
    let data: any
    try {
        ;({ data } = await api().post('/api/v1/address/generate', {
            to_address: evmAddress,
            to_address_signature: signature,
            to_chain: AVALANCHE_DESTINATION,
            nonce: 0,
            token_address: BTCB_ADAPTER,
        }))
    } catch (e: any) {
        const msg = String(e?.response?.data?.message ?? e?.message ?? e)
        if (/sanction/i.test(msg)) throw new Error('Lombard refuses this address (sanctions screening).')
        throw new Error(`Lombard could not create a deposit address: ${msg}`)
    }
    if (!data?.address) throw new Error('Lombard returned no deposit address.')
    return String(data.address)
}

/**
 * The deposit address for `signer`'s account: reused when it exists,
 * otherwise created — which needs one message signature from the C-Chain
 * account (run inside an authorization scope for it).
 */
export async function depositAddressFor(signer: EvmSigner): Promise<{ address: string; created: boolean }> {
    const existing = await existingDepositAddress(signer.address)
    if (existing) return { address: existing, created: false }
    if (!signer.signPersonalMessage) throw new Error('This wallet cannot sign the message Lombard needs.')
    const signature = await signer.signPersonalMessage(destinationMessage())
    return { address: await generateDepositAddress(signer.address, signature), created: true }
}

export interface DepositStatus {
    found: boolean
    /** Lombard's notarization state, e.g. NOTARIZATION_STATUS_PENDING. */
    notarization?: string
    /** The BTC.b mint on Avalanche, once done. */
    claimTx?: string
    /** Seconds Lombard says it has been waiting. */
    waitSeconds?: number
}

/** Where a Bitcoin deposit `btcTxid` to the account's deposit address stands. */
export async function depositStatus(evmAddress: string, btcTxid: string): Promise<DepositStatus> {
    const { data } = await api().get(`/api/v1/address/outputs-v2/${evmAddress}`)
    const o = (Array.isArray(data?.outputs) ? data.outputs : []).find((x: any) => String(x?.txid) === btcTxid)
    if (!o) return { found: false }
    return {
        found: true,
        notarization: String(o.notarization_status ?? ''),
        claimTx: o.claim_tx ? String(o.claim_tx) : undefined,
        waitSeconds: o.notarization_wait_dur ? Number(o.notarization_wait_dur) : undefined,
    }
}

export interface RedeemStatus {
    found: boolean
    completed: boolean
    /** BTC paid, in sats (after the commission). */
    amountSats?: number
    toAddress?: string
}

/** Where a BTC.b → BTC redeem (by its Avalanche tx hash) stands. */
export async function redeemStatus(evmAddress: string, avalancheTx: string): Promise<RedeemStatus> {
    const { data } = await api().get(`/api/v1/address/unstakes/${evmAddress}`, { params: { limit: 100, offset: 0 } })
    const u = (Array.isArray(data?.unstakes) ? data.unstakes : []).find((x: any) => String(x?.tx_hash).toLowerCase() === avalancheTx.toLowerCase())
    if (!u) return { found: false, completed: false }
    return {
        found: true,
        completed: u.session_state === 'SESSION_STATE_COMPLETED',
        amountSats: u.amount ? Number(u.amount) : undefined,
        toAddress: u.to_address ? String(u.to_address) : undefined,
    }
}

const ABI = [
    { name: 'getAssetRouter', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
    { name: 'toNativeCommission', type: 'function', stateMutability: 'view', inputs: [{ name: 'token', type: 'address' }], outputs: [{ name: '', type: 'uint64' }] },
    {
        name: 'tokenConfig',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'token', type: 'address' }],
        outputs: [
            { name: 'redeemFee', type: 'uint256' },
            { name: 'redeemForBtcMinAmount', type: 'uint256' },
            { name: 'isRedeemEnabled', type: 'bool' },
        ],
    },
    {
        name: 'redeemForBtc',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [
            { name: 'fromAddress', type: 'address' },
            { name: 'fromToken', type: 'address' },
            { name: 'recipientData', type: 'bytes' },
            { name: 'amount', type: 'uint256' },
        ],
        outputs: [],
    },
    { name: 'allowance', type: 'function', stateMutability: 'view', inputs: [{ name: 'o', type: 'address' }, { name: 's', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
    { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
    { name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 's', type: 'address' }, { name: 'a', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] },
]

export interface RedeemConfig {
    router: string
    /** Commission taken from the BTC paid out, in sats. */
    commissionSats: number
    /** Smallest redeem the router accepts on top of the commission, in sats. */
    minSats: number
    enabled: boolean
}

export async function redeemConfig(web3: Web3): Promise<RedeemConfig> {
    const adapter = new web3.eth.Contract(ABI as any, BTCB_ADAPTER)
    const router: string = await adapter.methods.getAssetRouter().call()
    const r = new web3.eth.Contract(ABI as any, router)
    const [commission, cfg] = await Promise.all([r.methods.toNativeCommission(BTCB_ADAPTER).call(), r.methods.tokenConfig(BTCB_ADAPTER).call()])
    return { router, commissionSats: Number(commission), minSats: Number(cfg.redeemForBtcMinAmount ?? cfg[1]), enabled: Boolean(cfg.isRedeemEnabled ?? cfg[2]) }
}

/** The output script Lombard pays to; refuses anything that is not a valid address on `network`. */
export function outputScriptFor(btcAddress: string, network: BitcoinNetwork): string {
    try {
        return '0x' + Buffer.from(bitcoin.address.toOutputScript(btcAddress.trim(), network.params)).toString('hex')
    } catch {
        throw new Error(`"${btcAddress}" is not a valid Bitcoin address.`)
    }
}

async function sendAndWait(signer: EvmSigner, req: { to: string; data: string; label: string }, fallbackGas: number): Promise<string> {
    const gasLimit = await signer.estimateGas(req, fallbackGas)
    const hash = await signer.send(Object.assign({}, req, { value: new BN(0), gasLimit }))
    if (isOfflineTxId(hash)) throw new Error('Turn off offline signing: each step must be broadcast.')
    const receipt = await signer.waitForReceipt(hash)
    if (!receipt.status) throw new Error(`${req.label} failed on chain.`)
    return receipt.txHash
}

/**
 * BTC.b → BTC: approves the adapter for exactly `amountSats` when needed,
 * then redeems to `btcAddress`. Run inside an authorization scope for the
 * C-Chain wallet. Returns the redeem transaction hash.
 */
export async function redeemToBitcoin(
    signer: EvmSigner,
    amountSats: bigint,
    btcAddress: string,
    network: BitcoinNetwork,
    onStep?: (label: string) => void
): Promise<{ txHash: string; approveTxHash: string | null }> {
    if (signer.network.evmChainId !== AVALANCHE_CHAIN_ID) throw new Error('BTC.b lives on Avalanche C-Chain. Switch your wallet to C-Chain.')
    await signer.assertOnChain()
    const web3 = signer.reader()
    const cfg = await redeemConfig(web3)
    if (!cfg.enabled) throw new Error('Lombard has paused BTC.b redemptions. Try again later.')
    if (amountSats < BigInt(cfg.commissionSats + cfg.minSats)) {
        throw new Error(`The smallest redeem is ${(cfg.commissionSats + cfg.minSats) / 1e8} BTC (it includes Lombard's ${cfg.commissionSats / 1e8} BTC fee).`)
    }
    const script = outputScriptFor(btcAddress, network)
    const token = new web3.eth.Contract(ABI as any, BTCB)
    const balance = BigInt(await token.methods.balanceOf(signer.address).call())
    if (balance < amountSats) throw new Error(`You hold ${Number(balance) / 1e8} BTC.b, less than ${Number(amountSats) / 1e8}.`)

    let approveTxHash: string | null = null
    const allowance = BigInt(await token.methods.allowance(signer.address, BTCB_ADAPTER).call())
    if (allowance < amountSats) {
        onStep?.('Approve BTC.b for Lombard')
        approveTxHash = await sendAndWait(signer, { to: BTCB, data: token.methods.approve(BTCB_ADAPTER, amountSats.toString()).encodeABI(), label: 'Approve BTC.b' }, APPROVE_GAS)
    }
    onStep?.('Redeem BTC.b for BTC')
    const router = new web3.eth.Contract(ABI as any, cfg.router)
    const txHash = await sendAndWait(
        signer,
        { to: cfg.router, data: router.methods.redeemForBtc(signer.address, BTCB_ADAPTER, script, amountSats.toString()).encodeABI(), label: 'Redeem BTC.b' },
        REDEEM_GAS
    )
    return { txHash, approveTxHash }
}

export async function btcbBalance(web3: Web3, owner: string): Promise<bigint> {
    return BigInt(await new web3.eth.Contract(ABI as any, BTCB).methods.balanceOf(owner).call())
}

export const __testing = { ABI }
