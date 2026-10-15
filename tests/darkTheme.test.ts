/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Guards the fix for dark text on dark backgrounds. Bootstrap's light-theme
 * defaults (#212529 text, white surfaces) reached any element sharing a
 * Bootstrap class name (.card, .table, .badge, …). Bootstrap runs in its dark
 * theme, with its palette pinned to the app's. The full, rendered check is
 * scripts/contrast-audit.cjs (needs the dev server and Chrome).
 */
import fs from 'fs'
import path from 'path'

const root = path.resolve(__dirname, '..')
const read = (f: string) => fs.readFileSync(path.join(root, f), 'utf8')

describe('the dark theme', () => {
    it('runs Bootstrap in its dark theme', () => {
        expect(read('index.html')).toMatch(/<html[^>]*\sdata-bs-theme="dark"/)
    })

    it("pins Bootstrap's text and surface colours to the app's palette", () => {
        const scss = read('src/_main.scss')
        const block = scss.match(/html\[data-bs-theme='dark'\]\s*\{([^}]*)\}/)?.[1] ?? ''
        expect(block).toContain('--bs-body-color: var(--primary-color)')
        expect(block).toContain('--bs-body-bg: var(--bg)')
        expect(block).toContain('--bs-secondary-color: var(--primary-color-light)')
        expect(block).toContain('--bs-heading-color: var(--primary-color)')
    })

    it('keeps disabled primary buttons readable: grey text on the dark surface', () => {
        const scss = read('src/_main.scss')
        const disabled = scss.match(/&\[disabled\],\s*&\.v-btn--disabled\s*\{([\s\S]*?)\n    \}/)?.[1] ?? ''
        expect(disabled).toContain('background-color: var(--bg-light) !important')
        expect(disabled).toContain('color: var(--primary-color-light) !important')
    })

    it('keeps the explorer clear of Bootstrap class names', () => {
        const dir = path.join(root, 'src/components/explorer')
        for (const f of fs.readdirSync(dir)) {
            expect(fs.readFileSync(path.join(dir, f), 'utf8')).not.toMatch(/class="[^"]*\b(card|badge)\b/)
        }
    })
})
