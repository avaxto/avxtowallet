/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Guards the fix for dark text on dark backgrounds. The cause was Bootstrap:
 * its light-theme defaults (#212529 text, white surfaces) reached any element
 * sharing a Bootstrap class name (.card, .table, .badge, …). Bootstrap has
 * been removed; Vuetify provides components, and src/styles/base.scss the
 * element defaults, in the app's own palette. The full, rendered check is
 * scripts/contrast-audit.cjs (needs the dev server and Chrome).
 */
import fs from 'fs'
import path from 'path'

const root = path.resolve(__dirname, '..')
const read = (f: string) => fs.readFileSync(path.join(root, f), 'utf8')

function filesUnder(dir: string, exts: string[]): string[] {
    const out: string[] = []
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
        const rel = path.join(dir, e.name)
        if (e.isDirectory()) out.push(...filesUnder(rel, exts))
        else if (exts.some((x) => e.name.endsWith(x))) out.push(rel)
    }
    return out
}

describe('the dark theme', () => {
    it('does not bring Bootstrap back', () => {
        const pkg = JSON.parse(read('package.json'))
        const deps = Object.assign({}, pkg.dependencies, pkg.devDependencies)
        expect(Object.keys(deps).filter((d) => /^bootstrap/.test(d))).toEqual([])
        for (const f of filesUnder('src', ['.ts', '.js', '.vue', '.scss'])) {
            expect({ f, imports: /(?:import|@use|@import)\s[^;\n]*['"](?:bootstrap|bootstrap-vue-next)(?:\/|['"])/.test(read(f)) }).toEqual({ f, imports: false })
        }
    })

    it('loads the base element styles once, after Vuetify’s reset', () => {
        const main = read('src/main.ts')
        expect(main).toContain("import './styles/base.scss'")
        expect(main.indexOf("import vuetify from './plugins/vuetify'")).toBeLessThan(main.indexOf("import './styles/base.scss'"))
    })

    it('keeps the shared .card light-text column the pages rely on', () => {
        const card = read('src/styles/base.scss').match(/\n\.card \{([^}]*)\}/)?.[1] ?? ''
        expect(card).toContain('display: flex')
        expect(card).toContain('flex-direction: column')
        expect(card).toContain('color: var(--primary-color)')
    })

    it('keeps disabled primary buttons readable: grey text on the dark surface', () => {
        const scss = read('src/_main.scss')
        const disabled = scss.match(/&\[disabled\],\s*&\.v-btn--disabled\s*\{([\s\S]*?)\n    \}/)?.[1] ?? ''
        expect(disabled).toContain('background-color: var(--bg-light) !important')
        expect(disabled).toContain('color: var(--primary-color-light) !important')
    })
})
