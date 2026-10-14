/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * The build-size changes: identical npm copies bundled once, and the QR
 * scanner and non-English languages loaded on demand instead of at startup.
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import { flushPromises, mount } from '@vue/test-utils'

// ── dedupe plugin ─────────────────────────────────────────────────────────────
// Loaded through a dynamic import: it is an ES module used by vite.config.mjs.
async function loadDedupe(): Promise<() => any> {
    const mod = await import(path.resolve(__dirname, '../scripts/vite-dedupe-packages.mjs'))
    return mod.default
}

function writePkg(dir: string, name: string, version: string, deps: Record<string, string> = {}) {
    fs.mkdirSync(path.join(dir, 'lib'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version, dependencies: deps }))
    fs.writeFileSync(path.join(dir, 'lib', 'index.js'), 'module.exports = 1')
}

/** node_modules with two identical copies of `same@1.0.0` and two copies of `risky@1.0.0` that see different `dep` versions. */
function fixture(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dedupe-'))
    const nm = path.join(root, 'node_modules')
    writePkg(path.join(nm, 'a', 'node_modules', 'same'), 'same', '1.0.0')
    writePkg(path.join(nm, 'b', 'node_modules', 'same'), 'same', '1.0.0')
    writePkg(path.join(nm, 'c', 'node_modules', 'same'), 'same', '2.0.0')
    writePkg(path.join(nm, 'a', 'node_modules', 'risky'), 'risky', '1.0.0', { dep: '*' })
    writePkg(path.join(nm, 'a', 'node_modules', 'dep'), 'dep', '1.0.0')
    writePkg(path.join(nm, 'b', 'node_modules', 'risky'), 'risky', '1.0.0', { dep: '*' })
    writePkg(path.join(nm, 'b', 'node_modules', 'dep'), 'dep', '2.0.0')
    return nm
}

async function resolver(nm: string) {
    const plugin = (await loadDedupe())()
    const ctx = { resolve: async (source: string) => ({ id: path.join(nm, source) }), info: () => {} }
    return (source: string) => plugin.resolveId.call(ctx, source, undefined, {}).then((r: any) => r.id.slice(nm.length + 1))
}

describe('the dedupe-packages build plugin', () => {
    it('sends every identical copy of a package to the first one seen', async () => {
        const nm = fixture()
        const resolve = await resolver(nm)
        expect(await resolve('a/node_modules/same/lib/index.js')).toBe('a/node_modules/same/lib/index.js')
        expect(await resolve('b/node_modules/same/lib/index.js')).toBe('a/node_modules/same/lib/index.js')
    })

    it('keeps a different version separate', async () => {
        const resolve = await resolver(fixture())
        await resolve('a/node_modules/same/lib/index.js')
        expect(await resolve('c/node_modules/same/lib/index.js')).toBe('c/node_modules/same/lib/index.js')
    })

    it('keeps copies separate when their dependencies resolve to different versions', async () => {
        const resolve = await resolver(fixture())
        await resolve('a/node_modules/risky/lib/index.js')
        expect(await resolve('b/node_modules/risky/lib/index.js')).toBe('b/node_modules/risky/lib/index.js')
    })

    it('only runs for production builds, and leaves app source alone', async () => {
        const plugin = (await loadDedupe())()
        expect(plugin.apply).toBe('build')
        const ctx = { resolve: async () => ({ id: '/app/src/main.ts' }) }
        expect(await plugin.resolveId.call(ctx, './main', undefined, {})).toEqual({ id: '/app/src/main.ts' })
    })
})

// ── QR scanner on demand ──────────────────────────────────────────────────────
const zxingLoaded = jest.fn()
const decode = jest.fn()
jest.mock('@zxing/library', () => {
    zxingLoaded()
    return { BrowserQRCodeReader: jest.fn(() => ({ decodeFromInputVideoDevice: decode, reset: jest.fn() })) }
})
jest.mock('@/stores', () => ({ useNotificationsStore: () => ({ add: jest.fn() }) }))

describe('the QR reader', () => {
    beforeEach(() => {
        Object.defineProperty(navigator, 'mediaDevices', {
            configurable: true,
            value: { enumerateDevices: async () => [{ kind: 'audioinput', deviceId: 'mic' }, { kind: 'videoinput', deviceId: 'cam' }] },
        })
    })

    it('finds the camera without loading the scanner, and loads it on the first tap', async () => {
        const { default: QrReader } = await import('@/vue_components/qr_reader.vue')
        decode.mockResolvedValue({ text: 'avax1scanned' })
        const w = mount(QrReader, { global: { stubs: { FontAwesomeIcon: true, 'font-awesome-icon': true } } })
        await flushPromises()
        expect(zxingLoaded).not.toHaveBeenCalled()
        await w.find('.clickStart').trigger('click')
        await flushPromises()
        expect(zxingLoaded).toHaveBeenCalledTimes(1)
        expect(decode).toHaveBeenCalledWith('cam', expect.anything())
        expect(w.emitted('change')).toEqual([['avax1scanned']])
        w.unmount()
    })
})

// ── languages on demand ───────────────────────────────────────────────────────
describe('languages', () => {
    const fakeI18n = () => {
        const loaded = new Set(['en'])
        const global = {
            locale: { value: 'en' },
            get availableLocales() {
                return Array.from(loaded)
            },
            setLocaleMessage: jest.fn((code: string) => loaded.add(code)),
        }
        return { global }
    }

    it('ships English only, and still offers every language the picker always had', async () => {
        const mod = await import('@/plugins/i18n.js')
        expect(Object.keys(mod.default)).toEqual(['en'])
        expect(mod.LOCALE_CODES).toEqual(['en', 'fr', 'tr', 'it', 'es', 'de', 'kr', 'ru', 'zh_hant', 'zh_hans', 'pt', 'vn', 'nl', 'uk', 'ca'])
    })

    it('loads a language once, on first use, then switches to it', async () => {
        const { setLocale } = await import('@/plugins/i18n.js')
        const i18n = fakeI18n()
        await setLocale(i18n, 'fr')
        await setLocale(i18n, 'en')
        await setLocale(i18n, 'fr')
        expect(i18n.global.setLocaleMessage).toHaveBeenCalledTimes(1)
        expect(i18n.global.setLocaleMessage.mock.calls[0][0]).toBe('fr')
        expect(i18n.global.locale.value).toBe('fr')
        await setLocale(i18n, 'xx')
        expect(i18n.global.locale.value).toBe('fr')
    })

    it('restores the language saved by the picker', async () => {
        const { restoreSavedLocale } = await import('@/plugins/i18n.js')
        localStorage.setItem('lang', 'de')
        const i18n = fakeI18n()
        restoreSavedLocale(i18n)
        await flushPromises()
        await new Promise((r) => setTimeout(r, 0))
        expect(i18n.global.locale.value).toBe('de')
        localStorage.removeItem('lang')
    })
})
