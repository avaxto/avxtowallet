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

/** Word counts of a BIP-39 phrase. 12 and 24 are the common ones. */
export const MNEMONIC_WORD_COUNTS = [12, 15, 18, 21, 24]

/**
 * Pulls a validated mnemonic (12 to 24 words) out of a parsed JSON-RPC response body,
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
    if (!MNEMONIC_WORD_COUNTS.includes(words.length)) {
        throw new Error('The phrase returned by AVXTO Manager is not a 12 or 24-word mnemonic.')
    }

    const phrase = words.join(' ')
    if (!bip39.validateMnemonic(phrase)) {
        throw new Error(
            'The phrase returned by AVXTO Manager is not a valid mnemonic. Make sure it is all lowercase.'
        )
    }

    return phrase
}

/**
 * Reads the mnemonic from a user-run AVXTO Manager JSON-RPC endpoint: posts
 * the `read` request with `password`, then validates what comes back with
 * `extractMnemonic`. Throws errors whose messages are safe to show.
 */
export async function fetchMnemonicFromManager(url: string, password: string): Promise<string> {
    const endpoint = url.trim()
    if (!endpoint) throw new Error('Enter the AVXTO Manager JSON-RPC URL.')
    if (!password) throw new Error('Enter the session password.')
    let response: Response
    try {
        response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(buildReadRequest(password)),
        })
    } catch {
        // A failed `fetch()` looks the same whether the server is down or the
        // browser blocked reading its response over CORS — the browser hides
        // the difference. For a self-hosted endpoint it is usually CORS: it
        // must send `Access-Control-Allow-Origin` (this page's origin, or `*`)
        // on both the POST response and the OPTIONS preflight.
        throw new Error(
            'Could not reach the AVXTO Manager endpoint, or it refused this page ' +
                "(check the browser console for a CORS error). The server must send " +
                "'Access-Control-Allow-Origin' for this page's origin, or '*', on " +
                'both the POST response and the OPTIONS preflight.'
        )
    }
    if (!response.ok) throw new Error(`AVXTO Manager returned an error (HTTP ${response.status}).`)
    let body: any
    try {
        body = await response.json()
    } catch {
        throw new Error('AVXTO Manager did not return valid JSON.')
    }
    return extractMnemonic(body)
}
