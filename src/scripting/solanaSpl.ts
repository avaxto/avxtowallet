/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * An SPL token transfer, built from the two instructions it needs rather than
 * pulling in @solana/spl-token: create the recipient's associated token
 * account if it does not exist (idempotent, paid by the sender), then
 * `TransferChecked`, which makes the token program verify the mint and its
 * decimals — a wrong-decimals amount fails on chain instead of moving 1000x.
 * Works for both the classic token program and Token-2022 (whichever owns
 * the mint).
 */
import { Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js'

export const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
export const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb')
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')

const TRANSFER_CHECKED = 12
const CREATE_IDEMPOTENT = 1

export function associatedTokenAddress(owner: PublicKey, mint: PublicKey, tokenProgram = TOKEN_PROGRAM_ID): PublicKey {
    return PublicKey.findProgramAddressSync(
        [owner.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()],
        ASSOCIATED_TOKEN_PROGRAM_ID
    )[0]
}

function u64le(v: bigint): Buffer {
    const b = Buffer.alloc(8)
    let x = v
    for (let i = 0; i < 8; i++) {
        b[i] = Number(x & BigInt(0xff))
        x >>= BigInt(8)
    }
    if (x !== BigInt(0)) throw new Error('Amount does not fit in a token transfer.')
    return b
}

export function createAtaIdempotentIx(payer: PublicKey, ata: PublicKey, owner: PublicKey, mint: PublicKey, tokenProgram: PublicKey) {
    return new TransactionInstruction({
        programId: ASSOCIATED_TOKEN_PROGRAM_ID,
        keys: [
            { pubkey: payer, isSigner: true, isWritable: true },
            { pubkey: ata, isSigner: false, isWritable: true },
            { pubkey: owner, isSigner: false, isWritable: false },
            { pubkey: mint, isSigner: false, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: tokenProgram, isSigner: false, isWritable: false },
        ],
        data: Buffer.from([CREATE_IDEMPOTENT]),
    })
}

export function transferCheckedIx(
    source: PublicKey,
    mint: PublicKey,
    destination: PublicKey,
    owner: PublicKey,
    amount: bigint,
    decimals: number,
    tokenProgram: PublicKey
) {
    return new TransactionInstruction({
        programId: tokenProgram,
        keys: [
            { pubkey: source, isSigner: false, isWritable: true },
            { pubkey: mint, isSigner: false, isWritable: false },
            { pubkey: destination, isSigner: false, isWritable: true },
            { pubkey: owner, isSigner: true, isWritable: false },
        ],
        data: Buffer.concat([Buffer.from([TRANSFER_CHECKED]), u64le(amount), Buffer.from([decimals])]),
    })
}

/** Builds the transfer (fee payer and blockhash are set when the wallet sends it). */
export async function buildSplTransfer(
    connection: Connection,
    from: string,
    to: string,
    mint: string,
    amount: bigint,
    decimals: number
): Promise<Transaction> {
    const owner = new PublicKey(from)
    const recipient = new PublicKey(to)
    const mintKey = new PublicKey(mint)
    const info = await connection.getAccountInfo(mintKey)
    if (!info) throw new Error(`Mint ${mint} does not exist on this network.`)
    const tokenProgram = info.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID
    if (!info.owner.equals(tokenProgram)) throw new Error(`${mint} is not an SPL token mint.`)

    const source = associatedTokenAddress(owner, mintKey, tokenProgram)
    const destination = associatedTokenAddress(recipient, mintKey, tokenProgram)
    const tx = new Transaction()
    tx.add(createAtaIdempotentIx(owner, destination, recipient, mintKey, tokenProgram))
    tx.add(transferCheckedIx(source, mintKey, destination, owner, amount, decimals, tokenProgram))
    tx.feePayer = owner
    return tx
}
