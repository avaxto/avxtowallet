/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Burning AVXTO through Moats. The properties worth pinning, because each
 * failure destroys or exposes funds rather than just erroring:
 *
 *  - the burn goes to the Moats contract's `burn(uint256)` with the exact wei
 *    amount (matches a real 1000 AVXTO burn, tx 0x226aa700…57dc);
 *  - approval is for exactly that amount, never unlimited, is skipped when an
 *    allowance already covers it, and is MINED before the burn is sent;
 *  - nothing is sent off Avalanche C-Chain, or if the hardcoded Moats address
 *    turns out not to burn AVXTO;
 *  - amounts are parsed strictly — a misparse here is destroyed.
 */
import Web3 from 'web3'

import { BN } from '@/avalanche'
import { AVXTO_CONTRACT_ADDRESS } from '@/avxto/AVXTOConf'
import type { EvmSigner, EvmTxRequest } from '@/evm/signer'
import {
    MOATS_CONTRACT_ADDRESS,
    burnAvxto,
    parseTokenAmount,
    validateBurnAmount,
    type BurnState,
} from '@/js/MoatsBurn'

const ME = '0x4887c61ee00a4df4191533f3e7be62bd00ea2537'
const ONE_THOUSAND = new BN('3635c9adc5dea00000', 16) // 1000e18, from the captured burn
const abi = new Web3().eth.abi

/** A web3 whose `eth_call`s answer from `chain` by function selector. */
function fakeReader(chain: { allowance: BN; stakingToken: string }): Web3 {
    const provider = {
        send(payload: any, cb: (err: any, res?: any) => void) {
            const [{ data }] = payload.params
            const selector = String(data).slice(0, 10)
            let result = '0x'
            if (selector === '0xdd62ed3e') result = abi.encodeParameter('uint256', chain.allowance.toString())
            if (selector === '0x72f702f3') result = abi.encodeParameter('address', chain.stakingToken)
            cb(null, { jsonrpc: '2.0', id: payload.id, result })
        },
    }
    return new Web3(provider as any)
}

interface Recorder {
    sends: EvmTxRequest[]
    events: string[]
}

function fakeSigner(
    opts: { chainId?: number; allowance?: BN; stakingToken?: string; offline?: boolean } = {}
): { signer: EvmSigner; rec: Recorder } {
    const rec: Recorder = { sends: [], events: [] }
    const reader = fakeReader({
        allowance: opts.allowance ?? new BN(0),
        stakingToken: opts.stakingToken ?? AVXTO_CONTRACT_ADDRESS,
    })
    const signer: EvmSigner = {
        network: { evmChainId: opts.chainId ?? 43114, name: 'Test chain' } as any,
        address: ME,
        authSubject: null,
        reader: () => reader,
        tokenRegistry: () => ({} as any),
        getGasPrice: async () => new BN(0),
        getNonce: async () => 7,
        estimateGas: async (_req, fallback) => fallback,
        send: async (req) => {
            rec.sends.push(req)
            const n = rec.sends.length
            rec.events.push(`send${n}`)
            return opts.offline ? `offline-${n}` : `0xhash${n}`
        },
        waitForReceipt: async (txHash) => {
            rec.events.push(`mined:${txHash}`)
            return { txHash, contractAddress: null, status: true }
        },
        assertOnChain: async () => {},
    }
    return { signer, rec }
}

jest.mock('@/stores/offlineSigning', () => ({
    isOfflineTxId: (id: string) => id.startsWith('offline-'),
}))

describe('burnAvxto', () => {
    it('approves exactly the amount, waits for it, then calls burn(amount) on Moats', async () => {
        const { signer, rec } = fakeSigner()
        const res = await burnAvxto(signer, ONE_THOUSAND)

        expect(rec.sends).toHaveLength(2)
        const [approve, burn] = rec.sends

        expect(approve.to!.toLowerCase()).toBe(AVXTO_CONTRACT_ADDRESS.toLowerCase())
        const approved = abi.decodeParameters(['address', 'uint256'], '0x' + approve.data!.slice(10))
        expect(String(approved[0]).toLowerCase()).toBe(MOATS_CONTRACT_ADDRESS)
        expect(approved[1]).toBe(ONE_THOUSAND.toString())

        expect(burn.to).toBe(MOATS_CONTRACT_ADDRESS)
        // Byte-for-byte the calldata of the real burn.
        expect(burn.data).toBe(
            '0x42966c6800000000000000000000000000000000000000000000003635c9adc5dea00000'
        )

        expect(rec.events).toEqual(['send1', 'mined:0xhash1', 'send2', 'mined:0xhash2'])
        expect(res).toEqual({ approveTxHash: '0xhash1', burnTxHash: '0xhash2', offline: false })
    })

    it('skips the approval when the allowance already covers the amount', async () => {
        const { signer, rec } = fakeSigner({ allowance: ONE_THOUSAND })
        const res = await burnAvxto(signer, ONE_THOUSAND)

        expect(rec.sends).toHaveLength(1)
        expect(rec.sends[0].to).toBe(MOATS_CONTRACT_ADDRESS)
        expect(res.approveTxHash).toBeNull()
    })

    it('sequences the burn behind an offline-captured approval', async () => {
        const { signer, rec } = fakeSigner({ offline: true })
        const res = await burnAvxto(signer, ONE_THOUSAND)

        expect(rec.sends.map((s) => s.nonce)).toEqual([7, 8])
        expect(rec.events.some((e) => e.startsWith('mined:'))).toBe(false)
        expect(res.offline).toBe(true)
    })

    it('sends nothing off Avalanche C-Chain', async () => {
        const { signer, rec } = fakeSigner({ chainId: 1 })
        await expect(burnAvxto(signer, ONE_THOUSAND)).rejects.toThrow(/Avalanche C-Chain/)
        expect(rec.sends).toHaveLength(0)
    })

    it('refuses when the Moats contract does not burn AVXTO', async () => {
        const { signer, rec } = fakeSigner({
            stakingToken: '0x000000000000000000000000000000000000beef',
        })
        await expect(burnAvxto(signer, ONE_THOUSAND)).rejects.toThrow(/does not burn AVXTO/)
        expect(rec.sends).toHaveLength(0)
    })
})

describe('parseTokenAmount', () => {
    it('parses whole and fractional amounts to wei', () => {
        expect(parseTokenAmount('1000', 18)!.eq(ONE_THOUSAND)).toBe(true)
        expect(parseTokenAmount('0.5', 18)!.toString()).toBe('500000000000000000')
        expect(parseTokenAmount(' 1.25 ', 2)!.toString()).toBe('125')
    })

    it('rejects anything that is not a plain decimal', () => {
        for (const bad of ['', '-1', '1e3', '1,000', '0x10', '1.', '.5', 'abc']) {
            expect(parseTokenAmount(bad, 18)).toBeNull()
        }
    })

    it('rejects more fraction digits than the token has, rather than rounding', () => {
        expect(parseTokenAmount('1.001', 2)).toBeNull()
    })
})

describe('validateBurnAmount', () => {
    const state: BurnState = {
        decimals: 18,
        balance: ONE_THOUSAND,
        allowance: new BN(0),
        userBurned: new BN(0),
        totalBurned: new BN(0),
        minAmount: new BN('1000000000000'),
        burningEnabled: true,
        paused: false,
    }

    it('accepts an amount within the balance and above the minimum', () => {
        expect(validateBurnAmount(ONE_THOUSAND, state)).toBeNull()
    })

    it('mirrors each of the contract checks', () => {
        expect(validateBurnAmount(new BN(0), state)).toMatch(/Enter an amount/)
        expect(validateBurnAmount(new BN(1), state)).toMatch(/minimum/)
        expect(validateBurnAmount(ONE_THOUSAND.addn(1), state)).toMatch(/more AVXTO/)
        expect(validateBurnAmount(ONE_THOUSAND, { ...state, paused: true })).toMatch(/paused/)
        expect(validateBurnAmount(ONE_THOUSAND, { ...state, burningEnabled: false })).toMatch(
            /disabled/
        )
    })
})
