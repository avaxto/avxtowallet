import { shallowRef } from 'vue'
import { SessionVault } from '@/js/security/SessionVault'

/**
 * Promise-based session password prompt.
 *
 * The codebase's modals are fire-and-forget (open()/close() plus an emit), but
 * an authorization has to *await* the user. This holds the pending request in a
 * module-level ref that SessionPasswordModal renders, and resolves once the
 * user submits or dismisses.
 *
 * The modal derives the key itself and resolves a CryptoKey — the password
 * string never leaves its closure and is never handed to callers.
 */

export interface PendingPrompt {
    /** What the user is being asked to authorize. */
    reason: string
    /** Set on a retry after a wrong password. */
    errorText?: string
    vault: SessionVault
    /** Resolves the awaiting withAuthorization call. Idempotent. */
    settle: (key: CryptoKey | null) => void
}

const pending = shallowRef<PendingPrompt | null>(null)

/** For SessionPasswordModal only. */
export function usePromptState() {
    return pending
}

/**
 * Asks for the session password.
 * Resolves with a derived non-extractable key, or null if the user cancelled.
 */
export function promptSessionKey(
    vault: SessionVault,
    reason: string,
    errorText?: string
): Promise<CryptoKey | null> {
    return new Promise((resolve) => {
        let settled = false

        pending.value = {
            reason,
            errorText,
            vault,
            // Guarded because several paths can close the modal — submit, the X
            // button, a backdrop click, Esc — and Modal.close() emits
            // beforeClose unconditionally, so a successful submit would
            // otherwise also resolve null a tick later.
            settle: (key: CryptoKey | null) => {
                if (settled) return
                settled = true
                pending.value = null
                resolve(key)
            },
        }
    })
}
