import { AuthScope, withAuthorization } from '@/js/security/session'
import { SessionVault } from '@/js/security/SessionVault'

/**
 * Wallet types that legitimately have no vault, because something else does
 * the authorizing: the Ledger device, or the browser extension.
 */
const EXTERNALLY_AUTHORIZED = new Set(['ledger', 'injected'])

/**
 * Runs a wallet operation inside an authorization scope.
 *
 * Vault-backed wallets prompt for the session password. Ledger and injected
 * wallets run straight through, since the device or extension authorizes.
 *
 * Deliberately fails loudly on anything it does not recognise. An earlier
 * version returned `fn()` whenever it could not find a vault, which meant a
 * mistyped wallet variable silently disabled the password prompt — the bug
 * that let X-chain sends through unauthorized. Skipping authorization must
 * only ever happen for a wallet type explicitly known not to need it.
 */
export async function authorizeWalletOp<T>(
    wallet: unknown,
    scope: AuthScope,
    reason: string,
    fn: () => Promise<T>
): Promise<T> {
    const w = wallet as { vault?: SessionVault; type?: string } | null | undefined

    if (!w) {
        throw new Error(
            `Cannot authorize "${reason}": no wallet was supplied. ` +
                `This is a bug at the call site — check the wallet argument.`
        )
    }

    if (w.vault) {
        return withAuthorization({ scope, reason, vault: w.vault }, () => fn())
    }

    if (w.type && EXTERNALLY_AUTHORIZED.has(w.type)) {
        return fn()
    }

    throw new Error(
        `Cannot authorize "${reason}": wallet of type "${w.type ?? 'unknown'}" ` +
            `has no session vault. Refusing to sign without authorization.`
    )
}

/** One transaction, one signature. */
export function authorizeSingle<T>(wallet: unknown, reason: string, fn: () => Promise<T>) {
    return authorizeWalletOp(wallet, AuthScope.SINGLE, reason, fn)
}

/** An export and its matching import, spanning the delay between them. */
export function authorizeCrossChain<T>(wallet: unknown, reason: string, fn: () => Promise<T>) {
    return authorizeWalletOp(wallet, AuthScope.CROSSCHAIN, reason, fn)
}

/** Many transactions from one password entry. */
export function authorizeBatch<T>(wallet: unknown, reason: string, fn: () => Promise<T>) {
    return authorizeWalletOp(wallet, AuthScope.BATCH, reason, fn)
}

export { AuthScope }
export { SessionAuthCancelled } from '@/js/security/session'
