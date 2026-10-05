/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Keeps one authorization scope open across several script steps, so a plan
 * (or a live run) costs one password entry per wallet rather than one per
 * transaction — the scripting plan's option (c): a BATCH scope whose reason
 * names the amounts the user approved.
 *
 * The session allows a single open scope at a time (js/security/session), so
 * moving to a step signed by a different wallet closes the current scope and
 * opens the next one (a new prompt). The BATCH limits (10 minutes, 500
 * operations) still apply on top of everything scripting enforces.
 *
 * The holder must always be released — the runner does it in `finally`, and
 * the page does it on unmount — or the open scope would cover unrelated
 * operations elsewhere in the app.
 */
import { authorizeBatch } from '@/js/security/authorize'

export class ScopeHolder {
    private subject: unknown = null
    private release: (() => void) | null = null
    private closed: Promise<unknown> | null = null

    /** Runs `fn` inside a scope for `subject`, opening (and prompting) only when the subject changes. */
    async run<T>(subject: unknown, reason: string, fn: () => Promise<T>): Promise<T> {
        if (!subject) throw new Error('No wallet to authorize this step with.')
        if (this.release && this.subject !== subject) await this.releaseNow()
        if (!this.release) await this.open(subject, reason)
        // Nested authorization inside the held scope reuses it (and counts the operation).
        return authorizeBatch(subject, reason, fn)
    }

    private open(subject: unknown, reason: string): Promise<void> {
        return new Promise<void>((acquired, failed) => {
            let held = false
            this.closed = authorizeBatch(subject, reason, () => {
                held = true
                this.subject = subject
                acquired()
                return new Promise<void>((resolve) => {
                    this.release = resolve
                })
            }).catch((e) => {
                if (!held) failed(e)
            })
        })
    }

    /** Closes the held scope, if any. */
    async releaseNow(): Promise<void> {
        const release = this.release
        const closed = this.closed
        this.release = null
        this.closed = null
        this.subject = null
        if (release) {
            release()
            await closed
        }
    }

    get isHolding(): boolean {
        return !!this.release
    }
}
