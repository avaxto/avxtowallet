/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Gas for a native AVAX send: an ordinary address gets exactly 21000, a
 * contract gets its real cost (a flat 21000 made a send to a proxy contract
 * revert out of gas on mainnet, tx 0xb515f1e1…), and a contract whose dry run
 * fails is refused before anything is signed.
 */
import { ContractRejectsTransferError, nativeTransferGasLimit } from '@/evm/nativeGas'
import { encodeMemoToTxData, intrinsicGasForData } from '@/evm/memo'

const FROM = '0xb61337bd98c4bec51150f545142339e1fbeecfaa'
const PROXY = '0x2490fd107ea83cd275e9aa64cb6ef6c1631f5d15'
const web3With = (code: string, estimate: () => Promise<any>) =>
    ({ eth: { getCode: jest.fn(async () => code), estimateGas: jest.fn(estimate) } }) as any

describe('nativeTransferGasLimit', () => {
    it('keeps exactly 21000 for an ordinary address, without asking for an estimate', async () => {
        const w3 = web3With('0x', async () => 99_999)
        expect(await nativeTransferGasLimit(w3, FROM, FROM, 10n)).toBe(21_000)
        expect(w3.eth.estimateGas).not.toHaveBeenCalled()
    })

    it('adds the memo bytes for an ordinary address', async () => {
        const memo = encodeMemoToTxData('rent')
        expect(await nativeTransferGasLimit(web3With('0x', async () => 0), FROM, FROM, 1n, memo)).toBe(
            21_000 + intrinsicGasForData(memo)
        )
    })

    it('gives a contract its estimate plus 20%, dry-running the same value and memo', async () => {
        const w3 = web3With('0x6080', async () => 30_000)
        const memo = encodeMemoToTxData('x')
        expect(await nativeTransferGasLimit(w3, FROM, PROXY, 5n, memo)).toBe(36_000)
        expect(w3.eth.estimateGas).toHaveBeenCalledWith({ from: FROM, to: PROXY, value: '5', data: memo })
    })

    it('refuses a contract whose dry run fails instead of signing 21000', async () => {
        const w3 = web3With('0x6080', async () => {
            throw new Error('execution reverted')
        })
        await expect(nativeTransferGasLimit(w3, FROM, PROXY, 5n)).rejects.toThrow(ContractRejectsTransferError)
        await expect(nativeTransferGasLimit(w3, FROM, PROXY, 5n)).rejects.toThrow(/execution reverted/)
    })
})
