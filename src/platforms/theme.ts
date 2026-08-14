/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Per-platform interface tinting.
 *
 * The app has one (dark) theme; this layer only re-tints the *accent* tokens on
 * top of it when the active platform declares a `theme`. Backgrounds and body
 * text are deliberately NOT overridable — a platform must not be able to render
 * the interface unreadable (that class of bug is exactly what the dark-theme
 * cleanup removed).
 *
 * Implementation is a single inline style block on <html> rather than mutating
 * `element.style` token by token, so switching platforms is one atomic write
 * and clearing it restores the stylesheet defaults from `_main.scss` exactly.
 */
import type { PlatformTheme } from './types'

const STYLE_ELEMENT_ID = 'platform-theme-overrides'

/**
 * Tokens a platform theme may override.
 *
 * `--secondary-color` is the app's accent (buttons, active nav, links); it is
 * what visually reads as "the brand colour" throughout the UI, so a platform
 * theme drives it plus the two tokens that must stay legible against it.
 */
function buildCss(theme: PlatformTheme): string {
    return `:root{
--secondary-color:${theme.accent};
--platform-accent:${theme.accent};
--platform-on-accent:${theme.onAccent};
--platform-logo:${theme.logo};
}`
}

function styleElement(): HTMLStyleElement {
    const existing = document.getElementById(STYLE_ELEMENT_ID)
    if (existing) return existing as HTMLStyleElement

    const el = document.createElement('style')
    el.id = STYLE_ELEMENT_ID
    document.head.appendChild(el)
    return el
}

/**
 * Apply a platform's theme, or clear back to the stylesheet defaults when the
 * platform declares none (passing `undefined`/`null`).
 */
export function applyPlatformTheme(theme?: PlatformTheme | null): void {
    // Guard for non-browser contexts (unit tests, SSR) so importing a platform
    // never requires a DOM.
    if (typeof document === 'undefined') return

    const el = styleElement()
    el.textContent = theme ? buildCss(theme) : ''
}
