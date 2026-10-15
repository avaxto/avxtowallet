/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Coin control on /wallet/transfer: listing the wallet's X- and P-Chain UTXOs,
 * and making sure a send only draws from the ones the user picked.
 *
 * Built on real SDK objects: the vendored avalanche.js for the X-Chain (and
 * its real transaction builder), @avalabs/avalanchejs for the P-Chain.
 */
const sdk = { prepareBaseTxn: jest.fn(), clientArgs: [] as any[] }
jest.mock('@avalanche-sdk/client', () => ({
    createAvalancheWalletClient: (args: any) => {
        sdk.clientArgs.push(args)
        return { pChain: { prepareBaseTxn: (p: any) => sdk.prepareBaseTxn(p) } }
    },
}))

import { BN, Buffer } from '@/avalanche'
import { KeyChain as AVMKeyChain, NFTTransferOutput, SECPTransferOutput, UTXO as AVMUTXO, UTXOSet as AVMUTXOSet } from '@/avalanche/apis/avm'
import { avm, bintools } from '@/AVA'
import { buildUnsignedTransaction } from '@/js/TxHelper'
import { listXCoins, pickedTotals, restrictedSet, unspendableReason } from '@/js/coinControl'
import { describe as describePSend, pCoinRows, preparePSend } from '@/js/pChainSend'
import { BigIntPr, Id, OutputOwners, TransferOutput, Utxo, avaxSerial, pvmSerial, utils } from '@avalabs/avalanchejs'

const fill = (byte: number, len = 32) => Buffer.alloc(len, byte)
const idx = (n: number) => {
    const b = Buffer.alloc(4)
    b.writeUInt32BE(n, 0)
    return b
}

describe('which UTXOs the wallet can spend alone', () => {
    const own = new Set(['avax1me'])
    it('accepts its own unlocked single-owner UTXO', () => {
        expect(unspendableReason(['X-avax1me'], 1, 0, own, 1000)).toBeUndefined()
    })
    it('refuses time-locked, multisig and foreign UTXOs, with a reason', () => {
        expect(unspendableReason(['X-avax1me'], 1, 2000, own, 1000)).toMatch(/locked until/)
        expect(unspendableReason(['X-avax1me', 'X-avax1other'], 2, 0, own, 1000)).toMatch(/multisig: needs 2 of 2/)
        expect(unspendableReason(['X-avax1other'], 1, 0, own, 1000)).toBe('not owned by this wallet')
    })
})

describe('X-Chain coin control', () => {
    const keychain = new AVMKeyChain('avax', 'X')
    const me = keychain.makeKey().getAddress()
    const other = keychain.makeKey().getAddress()
    const meStr = bintools.addressToString('avax', 'X', me)
    const AVAX = fill(0xaa)

    function wallet() {
        const set = new AVMUTXOSet()
        const mk = (i: number, amount: number, owners: Buffer[], threshold = 1, locktime = 0) =>
            new AVMUTXO(0, fill(0xb0 + i), idx(0), AVAX, new SECPTransferOutput(new BN(amount), owners, new BN(locktime), threshold))
        const utxos = [
            mk(1, 5_000_000_000, [me]), // 5 AVAX
            mk(2, 2_000_000_000, [me]), // 2 AVAX
            mk(3, 9_000_000_000, [me, other], 2), // multisig
            mk(4, 1_000_000_000, [me], 1, 4_000_000_000), // locked far into the future
            new AVMUTXO(0, fill(0xc0), idx(0), fill(0xdd), new NFTTransferOutput(1, Buffer.from('nft'), [me])),
        ]
        set.addArray(utxos)
        return { set, utxos }
    }

    it('lists fungible UTXOs largest first, with what can and cannot be picked', () => {
        const rows = listXCoins(wallet().set, [meStr])
        expect(rows.map((r) => [r.amount.toString(), r.spendable])).toEqual([
            ['9000000000', false],
            ['5000000000', true],
            ['2000000000', true],
            ['1000000000', false],
        ])
        expect(rows[0].reason).toMatch(/multisig/)
        expect(rows[3].reason).toMatch(/locked until/)
        expect(rows[1].owners).toEqual([meStr])
    })

    it('totals what is picked, per asset', () => {
        const rows = listXCoins(wallet().set, [meStr])
        const t = pickedTotals(rows, new Set([rows[1].utxoId, rows[2].utxoId]))
        expect(Object.values(t).map((v) => v.toString())).toEqual(['7000000000'])
    })

    it('builds the send from the picked UTXOs only — with the real builder', async () => {
        jest.spyOn(avm, 'getAVAXAssetID').mockResolvedValue(AVAX as any)
        jest.spyOn(avm, 'getTxFee').mockReturnValue(new BN(1_000_000))
        const { set } = wallet()
        const rows = listXCoins(set, [meStr])
        const small = rows.find((r) => r.amount.eq(new BN(2_000_000_000)))!
        const order = { asset: { id: bintools.cb58Encode(AVAX) }, amount: new BN(1_000_000_000) } as any

        // Unrestricted, the builder is free to take the 5 AVAX UTXO first …
        const free = await buildUnsignedTransaction([order], meStr, [meStr], set, meStr)
        const freeIns = free.getTransaction().getIns().map((i) => i.getUTXOID())
        // … restricted to the 2 AVAX one, it must use exactly that.
        const tx = await buildUnsignedTransaction([order], meStr, [meStr], restrictedSet(set, [small.utxoId]), meStr)
        const ins = tx.getTransaction().getIns().map((i) => i.getUTXOID())
        expect(ins).toEqual([small.utxoId])
        expect(freeIns).not.toEqual(ins)
    })

    it('fails plainly when the picked UTXOs cannot cover the amount', async () => {
        jest.spyOn(avm, 'getAVAXAssetID').mockResolvedValue(AVAX as any)
        jest.spyOn(avm, 'getTxFee').mockReturnValue(new BN(1_000_000))
        const { set } = wallet()
        const small = listXCoins(set, [meStr]).find((r) => r.amount.eq(new BN(2_000_000_000)))!
        const order = { asset: { id: bintools.cb58Encode(AVAX) }, amount: new BN(3_000_000_000) } as any
        await expect(buildUnsignedTransaction([order], meStr, [meStr], restrictedSet(set, [small.utxoId]), meStr)).rejects.toBeTruthy()
    })

    it('records which owner is the wallet’s own address', () => {
        const rows = listXCoins(wallet().set, [meStr])
        expect(rows.find((r) => r.amount.eq(new BN(5_000_000_000)))!.ownAddress).toBe(meStr)
        // Multisig: the wallet's own owner among several.
        expect(rows.find((r) => r.amount.eq(new BN(9_000_000_000)))!.ownAddress).toBe(meStr)
    })

    it('sends the change to the given address instead of the wallet’s change address — with the real builder', async () => {
        jest.spyOn(avm, 'getAVAXAssetID').mockResolvedValue(AVAX as any)
        jest.spyOn(avm, 'getTxFee').mockReturnValue(new BN(1_000_000))
        const walletChange = keychain.makeKey().getAddress()
        const walletChangeStr = bintools.addressToString('avax', 'X', walletChange)
        const dest = bintools.addressToString('avax', 'X', keychain.makeKey().getAddress())
        const { set } = wallet()
        const five = listXCoins(set, [meStr]).find((r) => r.amount.eq(new BN(5_000_000_000)))!
        const order = { asset: { id: bintools.cb58Encode(AVAX) }, amount: new BN(1_000_000_000) } as any
        const changeOwners = async (changeTo: string) => {
            const tx = await buildUnsignedTransaction([order], dest, [meStr], restrictedSet(set, [five.utxoId]), changeTo)
            return tx
                .getTransaction()
                .getOuts()
                .map((o) => (o.getOutput() as any).getAddresses().map((a: Buffer) => bintools.addressToString('avax', 'X', a)))
                .filter((owners: string[]) => !owners.includes(dest))
                .flat()
        }
        expect(await changeOwners(walletChangeStr)).toEqual([walletChangeStr])
        expect(await changeOwners(five.ownAddress!)).toEqual([meStr])
    })

    it('keeps the NFTs being sent in the restricted set', () => {
        const { set, utxos } = wallet()
        const nft = utxos[4]
        const r = restrictedSet(set, [], [nft])
        expect(r.getAllUTXOs().map((u) => u.getUTXOID())).toEqual([nft.getUTXOID()])
    })
})

describe('P-Chain coin control', () => {
    const meBytes = new Uint8Array(20).fill(1)
    const otherBytes = new Uint8Array(20).fill(2)
    const me = utils.format('P', 'avax', meBytes)
    const AVAX_ID = new Id(new Uint8Array(32).fill(0xaa))
    const OTHER_ASSET = new Id(new Uint8Array(32).fill(0xee))
    const now = 1_700_000_000

    const putxo = (n: number, amount: bigint, opts: { owners?: Uint8Array[]; threshold?: number; locktime?: bigint; stakeLock?: bigint; asset?: Id } = {}) => {
        const out = new TransferOutput(new BigIntPr(amount), OutputOwners.fromNative(opts.owners ?? [meBytes], opts.locktime ?? 0n, opts.threshold ?? 1))
        const output = opts.stakeLock ? new pvmSerial.StakeableLockOut(new BigIntPr(opts.stakeLock), out) : out
        return new Utxo(avaxSerial.UTXOID.fromNative(new Id(new Uint8Array(32).fill(n)).toString(), 0), opts.asset ?? AVAX_ID, output)
    }

    it('turns P-Chain UTXOs into picker rows, staked and foreign ones not pickable', () => {
        const rows = pCoinRows(
            [
                putxo(1, 3_000_000_000n),
                putxo(2, 8_000_000_000n, { stakeLock: BigInt(now + 86400) }),
                putxo(3, 1_000_000_000n, { owners: [meBytes, otherBytes], threshold: 2 }),
                putxo(4, 500n, { asset: OTHER_ASSET }),
            ],
            [me],
            'avax',
            AVAX_ID.toString(),
            now
        )
        expect(rows.map((r) => [r.amount.toString(), r.spendable])).toEqual([
            ['8000000000', false],
            ['3000000000', true],
            ['1000000000', false],
            ['500', false],
        ])
        expect(rows[0].reason).toMatch(/stake-locked/)
        expect(rows[2].reason).toMatch(/multisig/)
        expect(rows[3].reason).toBe('not AVAX')
        expect(rows[1].owners).toEqual([me])
        expect(rows[1].ownAddress).toBe(me)
    })

    it('reads the inputs used, the fee and the change off the built transaction', () => {
        const a = putxo(1, 3_000_000_000n)
        const b = putxo(2, 2_000_000_000n)
        const tx = {
            getInputUtxos: () => [b, a],
            getTx: () => ({ baseTx: { outputs: [{ amount: () => 1_000_000_000n }, { amount: () => 3_999_000_000n }] } }),
        }
        const p = describePSend(tx, 1_000_000_000n)
        expect(p.inputs.map((i) => i.utxoId)).toEqual([a.ID(), b.ID()])
        expect(p.fee.toString()).toBe('1000000')
        expect(p.change.toString()).toBe('3999000000')
    })

    it('hands the SDK only the picked UTXOs, every from-address, and no real key', async () => {
        const picked = putxo(1, 3_000_000_000n)
        sdk.prepareBaseTxn.mockResolvedValue({
            tx: { getInputUtxos: () => [picked], getTx: () => ({ baseTx: { outputs: [{ amount: () => 1n }, { amount: () => 2_998_999_999n }] } }) },
        })
        const p = await preparePSend({ to: 'avax1dest', amount: 1n, memo: 'hi', fromAddresses: ['avax1a', 'P-avax1b'], changeAddress: 'avax1a', utxos: [picked] })
        const params = sdk.prepareBaseTxn.mock.calls[0][0]
        expect(params.utxos).toEqual([picked])
        expect(params.fromAddresses).toEqual(['P-avax1a', 'P-avax1b'])
        expect(params.changeAddresses).toEqual(['P-avax1a'])
        expect(params.outputs).toEqual([{ amount: 1n, addresses: ['P-avax1dest'] }])
        expect(params.memo).toBe('hi')
        expect(sdk.clientArgs[0].account.xpAccount.publicKey).toMatch(/^0x02/)
        expect(p.fee.toString()).toBe('1000000')
    })

    it('leaves UTXO choice to the SDK when coin control is off', async () => {
        sdk.prepareBaseTxn.mockClear()
        sdk.prepareBaseTxn.mockResolvedValue({ tx: { getInputUtxos: () => [], getTx: () => ({ baseTx: { outputs: [] } }) } })
        await preparePSend({ to: 'P-avax1dest', amount: 1n, fromAddresses: ['avax1a'], changeAddress: 'avax1a' })
        expect(sdk.prepareBaseTxn.mock.calls[0][0]).not.toHaveProperty('utxos')
    })
})
