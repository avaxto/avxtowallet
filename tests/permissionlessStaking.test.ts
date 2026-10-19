/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Staking on the Primary Network with the permissionless transactions (ACP-62):
 * what the wallet hands the Avalanche SDK for a validator and a delegation,
 * and the staking periods it allows since the Helicon upgrade.
 */
const sdk = {
    validator: jest.fn(),
    delegator: jest.fn(),
    send: jest.fn(async () => ({ txHash: 'CORE-TX' })),
    clients: [] as any[],
}
jest.mock('@avalanche-sdk/client', () => ({
    createAvalancheWalletClient: (args: any) => {
        sdk.clients.push(args)
        return {
            pChain: {
                prepareAddPermissionlessValidatorTxn: (p: any) => sdk.validator(p),
                prepareAddPermissionlessDelegatorTxn: (p: any) => sdk.delegator(p),
            },
            sendXPTransaction: (p: any) => sdk.send(p),
        }
    },
}))
const issued: string[] = []
jest.mock('@/AVA', () => ({ pChain: { issueTx: async (hex: string) => (issued.push(hex), 'P-TX') }, bintools: { cb58Encode: (b: any) => `cb58(${b})` } }))
jest.mock('@/stores/offlineSigning', () => ({ useOfflineSigningStore: () => ({ isActive: false }) }))
jest.mock('@/stores/pinia', () => ({ pinia: {} }))
const chainUtxos: any[] = []
jest.mock('@avalabs/avalanchejs', () => {
    const actual = jest.requireActual('@avalabs/avalanchejs')
    return {
        ...actual,
        pvm: { ...actual.pvm, PVMApi: class { getUTXOs = async () => ({ utxos: chainUtxos, numFetched: chainUtxos.length }) } },
    }
})

import { BN } from '@/avalanche'
import {
    delegatePermissionlessLocal,
    delegatePermissionlessViaProvider,
    validatePermissionlessLocal,
    validatePermissionlessViaProvider,
} from '@/js/permissionlessDelegate'
import { sdkUtxosFor } from '@/js/pChainSend'
import { maxStakeEnd, minDelegationDurationMs, minStakeEnd, minValidationDurationMs, HOUR_MS, DAY_MS, STAKE_ACCEPTANCE_MARGIN_MS } from '@/constants'

const signedTx = () => ({
    toBytes: () => new Uint8Array([1]),
    addSignature: jest.fn(),
    hasAllSignatures: () => true,
    getSignedTx: () => ({ toBytes: () => new Uint8Array([7, 7]) }),
})
const account = { signTransaction: jest.fn(async () => '0xaa') }
const END = new Date('2027-03-01T00:00:00Z')
const BLS = { blsPublicKey: '0x' + '84'.repeat(48), blsSignature: '0x' + 'b5'.repeat(96) }

beforeEach(() => {
    sdk.validator.mockReset().mockResolvedValue({ tx: signedTx() })
    sdk.delegator.mockReset().mockResolvedValue({ tx: signedTx() })
    sdk.clients = []
    issued.length = 0
})

describe('adding a validator (AddPermissionlessValidatorTx)', () => {
    const base = {
        nodeID: 'NodeID-DwXjtHUrtuxdhekzCzHdEaoXHmFHRNLSF',
        amount: new BN('2000000000000'), // 2,000 AVAX
        end: END,
        fromAddresses: ['P-avax1a', 'P-avax1b'],
        changeAddress: 'P-avax1a',
        rewardAddress: 'P-avax1reward',
        delegationFee: 2.5,
        ...BLS,
    }

    it('sends the stake in nAVAX, the end in seconds, the fee, both reward owners and the node’s BLS key', async () => {
        const id = await validatePermissionlessLocal(base, [account])
        const p = sdk.validator.mock.calls[0][0]
        expect(p).toEqual({
            nodeId: base.nodeID,
            stakeInAvax: 2_000_000_000_000n, // nAVAX: the SDK passes it straight through as the tx weight
            end: BigInt(END.getTime() / 1000),
            rewardAddresses: ['P-avax1reward'],
            delegatorRewardAddresses: ['P-avax1reward'],
            delegatorRewardPercentage: 2.5,
            publicKey: BLS.blsPublicKey,
            signature: BLS.blsSignature,
            fromAddresses: ['P-avax1a', 'P-avax1b'],
            changeAddresses: ['P-avax1a'],
        })
        expect(p).not.toHaveProperty('start') // since Durango a validation starts at acceptance
        expect(account.signTransaction).toHaveBeenCalled()
        expect(id).toBe('P-TX')
    })

    it('stakes only the picked UTXOs when given', async () => {
        const utxos = [{ id: 'u1' }]
        await validatePermissionlessLocal({ ...base, utxos }, [account])
        expect(sdk.validator.mock.calls[0][0].utxos).toBe(utxos)
    })

    it('goes through Core for an injected wallet, from its single address', async () => {
        const provider = { request: jest.fn(async () => ({ xp: '0x02aa', evm: '0x03bb' })) }
        const id = await validatePermissionlessViaProvider(
            { ...base, fromAddress: 'P-avax1core', changeAddress: 'P-avax1core', rewardAddress: 'P-avax1core', evmAddress: '0x0000000000000000000000000000000000000001' },
            provider
        )
        expect(sdk.validator.mock.calls[0][0]).toMatchObject({ fromAddresses: ['P-avax1core'], changeAddresses: ['P-avax1core'] })
        expect(sdk.send.mock.calls[0][0]).toMatchObject({ chainAlias: 'P' })
        expect(id).toBe('CORE-TX')
    })
})

describe('delegating (AddPermissionlessDelegatorTx)', () => {
    const base = { nodeID: 'NodeID-x', amount: new BN('25000000000'), end: END, fromAddresses: ['P-avax1a'], changeAddress: 'P-avax1a', rewardAddress: 'P-avax1a' }

    it('sends the stake in nAVAX and stakes the picked UTXOs', async () => {
        const utxos = [{ id: 'u1' }]
        await delegatePermissionlessLocal({ ...base, utxos }, [account])
        const p = sdk.delegator.mock.calls[0][0]
        expect(p.stakeInAvax).toBe(25_000_000_000n)
        expect(p.utxos).toBe(utxos)
    })

    it('lets the SDK choose when nothing is picked', async () => {
        await delegatePermissionlessLocal(base, [account])
        expect(sdk.delegator.mock.calls[0][0]).not.toHaveProperty('utxos')
    })

    it('passes picked UTXOs through Core too', async () => {
        const provider = { request: jest.fn(async () => ({ xp: '0x02aa', evm: '0x03bb' })) }
        const utxos = [{ id: 'u9' }]
        await delegatePermissionlessViaProvider({ ...base, fromAddress: 'P-avax1core', evmAddress: '0x0000000000000000000000000000000000000001', utxos }, provider)
        expect(sdk.delegator.mock.calls[0][0].utxos).toBe(utxos)
    })
})

describe('picked UTXOs, mapped to the SDK’s objects', () => {
    const u = (tx: string, idx: number) => ({ utxoId: { txID: { toString: () => tx }, outputIdx: { value: () => idx } }, ID: () => `${tx}-${idx}` })

    it('finds them by creating transaction and output index', async () => {
        chainUtxos.splice(0, chainUtxos.length, u('T1', 0), u('T1', 1), u('T2', 0))
        const got = await sdkUtxosFor([{ txId: 'T1', outputIdx: 1 }, { txId: 'T2', outputIdx: 0 }], ['P-avax1a'])
        expect(got.map((x: any) => x.ID())).toEqual(['T1-1', 'T2-0'])
    })

    it('refuses rather than staking different UTXOs when one is gone', async () => {
        chainUtxos.splice(0, chainUtxos.length, u('T1', 0))
        await expect(sdkUtxosFor([{ txId: 'T9', outputIdx: 0 }], ['P-avax1a'])).rejects.toThrow(/no longer available/)
    })
})

describe('staking periods (Helicon, counted from acceptance)', () => {
    it('lets validators go down to 48 hours on mainnet and 12 on Fuji; delegators still need 14 days and 24 hours', () => {
        expect(minValidationDurationMs(1)).toBe(48 * HOUR_MS)
        expect(minValidationDurationMs(5)).toBe(12 * HOUR_MS)
        expect(minDelegationDurationMs(1)).toBe(14 * DAY_MS)
        expect(minDelegationDurationMs(5)).toBe(DAY_MS)
    })

    it('measures both limits from now, leaving room for acceptance', () => {
        const now = 1_800_000_000_000
        expect(maxStakeEnd(now)).toBe(now + 365 * DAY_MS - STAKE_ACCEPTANCE_MARGIN_MS)
        expect(minStakeEnd(48 * HOUR_MS, now)).toBe(now + 48 * HOUR_MS + STAKE_ACCEPTANCE_MARGIN_MS)
    })
})
