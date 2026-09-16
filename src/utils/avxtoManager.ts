/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * The AVXTO Manager JSON-RPC protocol: posting a session password to a
 * user-run endpoint and reading a mnemonic phrase back out of it — an
 * alternative to pasting the phrase directly, for whoever keeps it behind
 * their own key-management service. See views/access/Mnemonic.vue for the
 * form that calls this.
 *
 * Split out of that component so the actual interesting behavior — building
 * the request, and every way a response can legitimately or illegitimately
 * fail to hand back a usable mnemonic — can be unit tested without mounting
 * a component, the same way solana/rpc.ts's `withRpcErrors` is tested apart
 * from the views that call it.
 */
import * as bip39 from 'bip39'

export interface AvxtoManagerReadRequest {
    jsonrpc: '2.0'
    id: 1
    method: 'read'
    params: { password: string }
}

/** The JSON-RPC request body — a plain object, not yet serialized. */
export function buildReadRequest(password: string): AvxtoManagerReadRequest {
    return { jsonrpc: '2.0', id: 1, method: 'read', params: { password } }
}

/**
 * Pulls a validated 24-word mnemonic out of a parsed JSON-RPC response body,
 * or throws an `Error` whose message is safe to show the user directly.
 *
 * Accepts the mnemonic at `result.mnemonic` (the standard JSON-RPC 2.0
 * envelope) or a bare top-level `mnemonic` — servers that describe
 * themselves as returning "a JSON-RPC response" don't all agree on how
 * strictly to wrap the result, and there is nothing gained by being
 * pedantic about it here; the wallet only cares that the phrase is real.
 */
export function extractMnemonic(body: any): string {
    // A JSON-RPC error object means the request reached the server and was
    // rejected there (wrong password, unknown method, ...) — surface its
    // message rather than the generic "no mnemonic" below.
    if (body?.error) {
        throw new Error(body.error.message || 'AVXTO Manager rejected the request.')
    }

    const mnemonic = String(body?.result?.mnemonic ?? body?.mnemonic ?? '').trim()
    if (!mnemonic) {
        throw new Error('AVXTO Manager response did not include a mnemonic.')
    }

    const words = mnemonic.split(/\s+/).filter(Boolean)
    if (words.length !== 24) {
        throw new Error('The phrase returned by AVXTO Manager is not a 24-word mnemonic.')
    }

    if (!bip39.validateMnemonic(mnemonic)) {
        throw new Error(
            'The phrase returned by AVXTO Manager is not a valid mnemonic. Make sure it is all lowercase.'
        )
    }

    return mnemonic
}
