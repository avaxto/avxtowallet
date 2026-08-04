import { SessionVault, KeyProvider, SecretName } from '@/js/security/SessionVault'
import { promptSessionKey } from '@/js/security/passwordPrompt'

/**
 * Session authorization.
 *
 * A signing operation must run inside `withAuthorization`, which prompts for
 * the session password, derives the key, and disposes it when the operation
 * settles. Scope decides how long one authorization covers:
 *
 *   SINGLE      one transaction
 *   CROSSCHAIN  an export and its matching import, across the delay between
 *   BATCH       every transaction in a batch
 *
 * Deliberately a plain module, not a Pinia store: stores wrap their state in
 * reactive proxies, and a proxied CryptoKey fails WebCrypto's brand check.
 */

export enum AuthScope {
    SINGLE = 'single',
    CROSSCHAIN = 'crosschain',
    BATCH = 'batch',
}

/** The user dismissed the password prompt. Callers should abort quietly. */
export class SessionAuthCancelled extends Error {
    constructor() {
        super('Authorization cancelled.')
        this.name = 'SessionAuthCancelled'
    }
}

/** A signing primitive was reached outside any authorized scope. */
export class NotAuthorized extends Error {
    constructor() {
        super('This operation requires the session password.')
        this.name = 'NotAuthorized'
    }
}

/** A long-running scope hit its wall-clock or operation cap. */
export class SessionScopeExpired extends Error {
    constructor(detail: string) {
        super(`Authorization expired: ${detail}. Re-authorize to continue.`)
        this.name = 'SessionScopeExpired'
    }
}

/** Another wallet's operation is already holding an authorization. */
export class SessionBusy extends Error {
    constructor() {
        super('Another authorized operation is already in progress.')
        this.name = 'SessionBusy'
    }
}

/**
 * Grants access to vault secrets for the life of one scope.
 *
 * `dispose()` poisons rather than merely drops: every later `getKey()` throws.
 * So a handle captured by a closure that outlives its scope is inert, which is
 * what makes the `finally` in withAuthorization an actual guarantee rather
 * than a convention.
 */
export class AuthHandle implements KeyProvider {
    readonly scope: AuthScope
    readonly vault: SessionVault
    readonly startedAt = Date.now()
    private key: CryptoKey | null
    private disposed = false
    private opCount = 0

    constructor(scope: AuthScope, vault: SessionVault, key: CryptoKey) {
        this.scope = scope
        this.vault = vault
        this.key = key
    }

    /**
     * Bounds how long one authorization stays usable. A scope that can be held
     * indefinitely is not really a scope — a compromised page could keep a
     * batch open and sign with it forever.
     */
    assertWithinLimits(): void {
        if (this.scope === AuthScope.SINGLE) return

        const limits = SCOPE_LIMITS[this.scope]
        if (Date.now() - this.startedAt > limits.maxMs) {
            throw new SessionScopeExpired(
                `open longer than ${Math.round(limits.maxMs / 60000)} minutes`
            )
        }
        if (this.opCount >= limits.maxOps) {
            throw new SessionScopeExpired(`covered ${limits.maxOps} operations`)
        }
    }

    /** Called once per nested operation that reuses this authorization. */
    countOperation(): void {
        this.opCount += 1
    }

    getKey(): CryptoKey {
        if (this.disposed || !this.key) {
            throw new NotAuthorized()
        }
        return this.key
    }

    get isDisposed(): boolean {
        return this.disposed
    }

    dispose(): void {
        this.key = null
        this.disposed = true
    }
}

export interface AuthorizeOptions {
    scope: AuthScope
    /** Shown in the prompt so the user knows what they are approving. */
    reason: string
    vault: SessionVault
    /** Secret used to check the password before the operation starts. */
    canary?: SecretName
}

const SCOPE_LIMITS: Record<AuthScope, { maxMs: number; maxOps: number }> = {
    [AuthScope.SINGLE]: { maxMs: Infinity, maxOps: Infinity },
    // An export, a wait, then an import — generous, but not unbounded.
    [AuthScope.CROSSCHAIN]: { maxMs: 15 * 60 * 1000, maxOps: 8 },
    // Long batches are legitimate; a 10 minute / 500 op ceiling still bounds them.
    [AuthScope.BATCH]: { maxMs: 10 * 60 * 1000, maxOps: 500 },
}

/** The currently open scope, if any. Single-threaded JS makes one slot sound. */
let ambient: AuthHandle | null = null

/** Indirection so tests can drive authorization without rendering the modal. */
let promptImpl: typeof promptSessionKey = promptSessionKey

const scopeClosedListeners = new Set<() => void>()

/** True while any authorized operation is in flight. */
export function isScopeActive(): boolean {
    return ambient !== null && !ambient.isDisposed
}

/** Notified whenever the last open scope closes. Used by the idle lock so it
 *  never fires mid-batch. */
export function onScopeClosed(fn: () => void): () => void {
    scopeClosedListeners.add(fn)
    return () => scopeClosedListeners.delete(fn)
}

/**
 * The ambient authorization, for use inside a signing primitive.
 * Throws if no scope is open — the invariant that keeps every signing path
 * behind a password.
 */
export function requireAuth(vault?: SessionVault): AuthHandle {
    if (!ambient || ambient.isDisposed) {
        throw new NotAuthorized()
    }
    if (vault && ambient.vault !== vault) {
        throw new SessionBusy()
    }
    return ambient
}

/**
 * Runs `fn` with an authorization in scope.
 *
 * Nested calls reuse the open authorization instead of re-prompting — that is
 * what lets a cross-chain transfer sign twice, and a batch sign N times, from
 * one password entry. Only the outermost call disposes.
 */
export async function withAuthorization<T>(
    opts: AuthorizeOptions,
    fn: (auth: AuthHandle) => Promise<T>
): Promise<T>
{
    // Already inside a scope: reuse it, and leave disposal to the owner.
    if (ambient && !ambient.isDisposed) {
        if (ambient.vault !== opts.vault) {
            throw new SessionBusy()
        }
        ambient.assertWithinLimits()
        ambient.countOperation()
        return fn(ambient)
    }

    const auth = await acquire(opts)
    ambient = auth

    try {
        return await fn(auth)
    } finally {
        auth.dispose()
        ambient = null
        for (const listener of scopeClosedListeners) {
            try {
                listener()
            } catch {
                // A listener must never break the operation that just finished.
            }
        }
    }
}

/**
 * Prompts until the password is right or the user gives up.
 *
 * The canary decrypt matters: without it a wrong password would surface at the
 * first secret access, which for a cross-chain transfer could be *after* the
 * export is already broadcast. Verifying up front keeps the failure atomic.
 */
async function acquire(opts: AuthorizeOptions): Promise<AuthHandle> {
    const canary = opts.canary ?? pickCanary(opts.vault)
    let errorText: string | undefined

    for (;;) {
        const key = await promptImpl(opts.vault, opts.reason, errorText)
        if (!key) throw new SessionAuthCancelled()

        const auth = new AuthHandle(opts.scope, opts.vault, key)

        if (!canary) return auth // nothing stored yet (initial setup)

        try {
            await opts.vault.verify(auth, canary)
            return auth
        } catch (e) {
            auth.dispose()
            errorText = 'Incorrect password.'
        }
    }
}

function pickCanary(vault: SessionVault): SecretName | null {
    const order: SecretName[] = ['seed', 'pk', 'mnemonic']
    return order.find((n) => vault.has(n)) ?? null
}

/** Test seam. Never call from application code. */
export function __resetSessionForTests(): void {
    ambient?.dispose()
    ambient = null
    scopeClosedListeners.clear()
    promptImpl = promptSessionKey
}

/** Test seam. Never call from application code. */
export function __setPromptForTests(fn: typeof promptSessionKey): void {
    promptImpl = fn
}
