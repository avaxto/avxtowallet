/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * ARENA bridge encoders, checked against the two real transactions.
 *
 * The calldata below is not hand-written: it is what arenatrade.ai actually
 * sent, and for the Robinhood leg it is byte-identical to the mined
 * transaction 0x6d399694…df83c. Encoding our own params and comparing covers
 * the whole ABI layout at once — tuple offsets, the bytes32 recipient padding,
 * both amounts, the fee, and all three empty bytes fields. If any part of the
 * reverse-engineered shape were wrong, these would not match.
 */
import {
    ARENA_OFT_ADAPTER,
    ARENA_TOKEN_AVALANCHE,
    ARENA_TOKEN_ROBINHOOD,
    addressToBytes32,
    buildApproveTx,
    buildSendTx,
    floorToConversionRate,
    getRoute,
    oppositeDirection,
    type BridgeQuote,
} from '@/evm/bridge/arenaOft'

const SENDER = '0x4a0fee7e85f8d536bc55bf509f5fee3e5548c779'

/** Avalanche -> Robinhood: 123 ARENA, fee 0x16b46252b03b8d AVAX. */
const AVAX_TO_RH_SEND =
    '0xc7c7f5b3' +
    '0000000000000000000000000000000000000000000000000000000000000080' +
    '0000000000000000000000000000000000000000000000000016b46252b03b8d' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000004a0fee7e85f8d536bc55bf509f5fee3e5548c779' +
    '00000000000000000000000000000000000000000000000000000000000076d0' +
    '0000000000000000000000004a0fee7e85f8d536bc55bf509f5fee3e5548c779' +
    '000000000000000000000000000000000000000000000006aaf7c8516d0c0000' +
    '000000000000000000000000000000000000000000000006aaf7c8516d0c0000' +
    '00000000000000000000000000000000000000000000000000000000000000e0' +
    '0000000000000000000000000000000000000000000000000000000000000100' +
    '0000000000000000000000000000000000000000000000000000000000000120' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000'

const AVAX_TO_RH_APPROVE =
    '0x095ea7b3' +
    '000000000000000000000000a59ad32dad425250ca3601f964d92611818f86f7' +
    '000000000000000000000000000000000000000000000006aaf7c8516d0c0000'

/** Robinhood -> Avalanche: 207 ARENA, fee 0x14c298ca6be3 ETH. */
const RH_TO_AVAX_SEND =
    '0xc7c7f5b3' +
    '0000000000000000000000000000000000000000000000000000000000000080' +
    '000000000000000000000000000000000000000000000000000014c298ca6be3' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000004a0fee7e85f8d536bc55bf509f5fee3e5548c779' +
    '000000000000000000000000000000000000000000000000000000000000759a' +
    '0000000000000000000000004a0fee7e85f8d536bc55bf509f5fee3e5548c779' +
    '00000000000000000000000000000000000000000000000b38b3bb4459dc0000' +
    '00000000000000000000000000000000000000000000000b38b3bb4459dc0000' +
    '00000000000000000000000000000000000000000000000000000000000000e0' +
    '0000000000000000000000000000000000000000000000000000000000000100' +
    '0000000000000000000000000000000000000000000000000000000000000120' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000'

const ARENA_123 = BigInt('123000000000000000000')
const ARENA_207 = BigInt('207000000000000000000')

function quoteFor(
    direction: 'avalanche-to-robinhood' | 'robinhood-to-avalanche',
    amount: bigint,
    nativeFee: bigint
): BridgeQuote {
    return {
        direction,
        amountSentLD: amount,
        amountReceivedLD: amount,
        nativeFee,
        dustLD: BigInt(0),
        maxTransferLD: BigInt('4670000000000000000000000'),
        sendParam: {
            dstEid: getRoute(direction).dstEid,
            to: addressToBytes32(SENDER),
            amountLD: amount.toString(),
            minAmountLD: amount.toString(),
            extraOptions: '0x',
            composeMsg: '0x',
            oftCmd: '0x',
        },
    }
}

describe('ARENA bridge routes', () => {
    it('sends the Avalanche leg through the adapter, with an approval', () => {
        const route = getRoute('avalanche-to-robinhood')
        expect(route.sourceChainId).toBe(43114)
        expect(route.dstEid).toBe(30416)
        expect(route.sourceContract.toLowerCase()).toBe(ARENA_OFT_ADAPTER.toLowerCase())
        expect(route.approvalToken?.toLowerCase()).toBe(ARENA_TOKEN_AVALANCHE.toLowerCase())
    })

    it('sends the Robinhood leg through the token itself, with no approval', () => {
        const route = getRoute('robinhood-to-avalanche')
        expect(route.sourceChainId).toBe(4663)
        expect(route.dstEid).toBe(30106)
        // The OFT is the token: `approvalRequired()` is false on this side.
        expect(route.sourceContract.toLowerCase()).toBe(ARENA_TOKEN_ROBINHOOD.toLowerCase())
        expect(route.approvalToken).toBeNull()
    })

    it('flips both ways', () => {
        expect(oppositeDirection('avalanche-to-robinhood')).toBe('robinhood-to-avalanche')
        expect(oppositeDirection('robinhood-to-avalanche')).toBe('avalanche-to-robinhood')
    })
})

describe('ARENA bridge calldata', () => {
    it('reproduces the captured Avalanche -> Robinhood send', () => {
        const tx = buildSendTx(quoteFor('avalanche-to-robinhood', ARENA_123, BigInt('0x16b46252b03b8d')), SENDER)
        expect(tx.to.toLowerCase()).toBe(ARENA_OFT_ADAPTER.toLowerCase())
        expect(tx.data.toLowerCase()).toBe(AVAX_TO_RH_SEND)
        expect(tx.value).toBe('0x16b46252b03b8d')
    })

    it('reproduces the captured Avalanche approval', () => {
        const tx = buildApproveTx('avalanche-to-robinhood', ARENA_123)
        expect(tx.to.toLowerCase()).toBe(ARENA_TOKEN_AVALANCHE.toLowerCase())
        expect(tx.data.toLowerCase()).toBe(AVAX_TO_RH_APPROVE)
        expect(tx.value).toBeUndefined()
    })

    it('reproduces the mined Robinhood -> Avalanche send', () => {
        const tx = buildSendTx(quoteFor('robinhood-to-avalanche', ARENA_207, BigInt('0x14c298ca6be3')), SENDER)
        expect(tx.to.toLowerCase()).toBe(ARENA_TOKEN_ROBINHOOD.toLowerCase())
        expect(tx.data.toLowerCase()).toBe(RH_TO_AVAX_SEND)
        expect(tx.value).toBe('0x14c298ca6be3')
    })

    it('refuses to build an approval for the leg that has none', () => {
        expect(() => buildApproveTx('robinhood-to-avalanche', ARENA_207)).toThrow(
            /does not use an approval/
        )
    })
})

describe('ARENA dust flooring', () => {
    const RATE = BigInt('1000000000000')

    it('leaves an exact multiple alone', () => {
        expect(floorToConversionRate(ARENA_123, RATE)).toBe(ARENA_123)
    })

    it('drops sub-step dust', () => {
        // 1.0000000000005 -> 1.0, losing 500000 wei.
        const amount = BigInt('1000000000000500000')
        expect(floorToConversionRate(amount, RATE)).toBe(BigInt('1000000000000000000'))
    })

    it('floors an amount below one step to zero', () => {
        expect(floorToConversionRate(BigInt('999999999999'), RATE)).toBe(BigInt(0))
    })
})

describe('addressToBytes32', () => {
    it('left-pads to 32 bytes', () => {
        expect(addressToBytes32(SENDER)).toBe(
            '0x0000000000000000000000004a0fee7e85f8d536bc55bf509f5fee3e5548c779'
        )
    })

    it('rejects a non-address', () => {
        expect(() => addressToBytes32('0xnope')).toThrow(/Invalid address/)
    })
})
