/**
 * @jest-environment node
 */
/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Two building blocks of script execution: the authorization holder (one
 * password prompt per run of same-wallet steps, always released) and the SPL
 * transfer instructions, checked byte for byte against the official
 * @solana/spl-token library.
 */
import { Keypair, PublicKey } from '@solana/web3.js'

const prompts: unknown[] = []
const closed: unknown[] = []
let ambient: unknown = null
jest.mock('@/js/security/authorize', () => ({
    authorizeBatch: async (w: unknown, _r: string, fn: () => Promise<unknown>) => {
        if (ambient) {
            if (ambient !== w) throw new Error('SessionBusy')
            return fn()
        }
        if ((w as any)?.cancel) throw new Error('cancelled')
        prompts.push(w)
        ambient = w
        try {
            return await fn()
        } finally {
            ambient = null
            closed.push(w)
        }
    },
}))

import { ScopeHolder } from '@/scripting/scope'
import {
    associatedTokenAddress,
    createAtaIdempotentIx,
    transferCheckedIx,
    TOKEN_PROGRAM_ID,
    TOKEN_2022_PROGRAM_ID,
} from '@/scripting/solanaSpl'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const spl = require('../node_modules/@wormhole-foundation/sdk-solana/node_modules/@solana/spl-token')

describe('ScopeHolder', () => {
    beforeEach(() => {
        prompts.length = 0
        closed.length = 0
        ambient = null
    })

    it('prompts once for consecutive steps on one wallet, and again when the wallet changes', async () => {
        const a = { w: 'a' }
        const b = { w: 'b' }
        const h = new ScopeHolder()
        expect(await h.run(a, 'r', async () => 1)).toBe(1)
        expect(await h.run(a, 'r', async () => 2)).toBe(2)
        expect(prompts).toEqual([a])
        expect(h.isHolding).toBe(true)
        await h.run(b, 'r', async () => 3)
        expect(prompts).toEqual([a, b])
        expect(closed).toEqual([a])
        await h.releaseNow()
        expect(closed).toEqual([a, b])
        expect(h.isHolding).toBe(false)
        expect(ambient).toBeNull()
    })

    it('passes a cancelled prompt through and holds nothing', async () => {
        const h = new ScopeHolder()
        await expect(h.run({ cancel: true }, 'r', async () => 1)).rejects.toThrow('cancelled')
        expect(h.isHolding).toBe(false)
    })

    it('stays open after a failed step, for the release to close', async () => {
        const a = { w: 'a' }
        const h = new ScopeHolder()
        await expect(h.run(a, 'r', async () => Promise.reject(new Error('reverted')))).rejects.toThrow('reverted')
        expect(h.isHolding).toBe(true)
        await h.releaseNow()
        expect(ambient).toBeNull()
    })

    it('refuses a step with no wallet', async () => {
        await expect(new ScopeHolder().run(null, 'r', async () => 1)).rejects.toThrow(/No wallet/)
    })
})

describe('SPL transfer instructions', () => {
    const owner = Keypair.generate().publicKey
    const recipient = Keypair.generate().publicKey
    const mint = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')
    const same = (a: any, b: any) => {
        expect(a.programId.toBase58()).toBe(b.programId.toBase58())
        expect(Buffer.from(a.data).toString('hex')).toBe(Buffer.from(b.data).toString('hex'))
        expect(a.keys.map((k: any) => [k.pubkey.toBase58(), k.isSigner, k.isWritable])).toEqual(
            b.keys.map((k: any) => [k.pubkey.toBase58(), k.isSigner, k.isWritable])
        )
    }

    it('derives the same associated token accounts as spl-token, for both token programs', () => {
        for (const program of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
            expect(associatedTokenAddress(owner, mint, program).toBase58()).toBe(
                spl.getAssociatedTokenAddressSync(mint, owner, false, program).toBase58()
            )
        }
    })

    it('builds the same create-if-missing and TransferChecked instructions', () => {
        const ata = associatedTokenAddress(recipient, mint)
        same(createAtaIdempotentIx(owner, ata, recipient, mint, TOKEN_PROGRAM_ID), spl.createAssociatedTokenAccountIdempotentInstruction(owner, ata, recipient, mint))
        const src = associatedTokenAddress(owner, mint)
        const amount = BigInt('123456789012')
        same(
            transferCheckedIx(src, mint, ata, owner, amount, 6, TOKEN_PROGRAM_ID),
            spl.createTransferCheckedInstruction(src, mint, ata, owner, amount, 6)
        )
    })
})
