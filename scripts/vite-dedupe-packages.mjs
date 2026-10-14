/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
*/
/*
 * Bundles each identical npm package once.
 *
 * Yarn installs a private copy of a package wherever the version hoisted to the
 * top of node_modules doesn't fit (the four Wormhole SDK packages each carry
 * ethers 6.17.0, because the app itself is on ethers 5). Rollup keys modules by
 * path, so it parsed, held in memory and shipped every copy: about 5 MB of the
 * 26 MB bundle (bn.js ×15, @solana/web3.js ×6, ethers ×5, axios ×6, …) and a
 * matching share of the build's memory.
 *
 * This plugin redirects each resolved file inside a duplicate copy to the same
 * file in one chosen copy of that package — only when the two copies are the
 * same version AND every dependency the package declares resolves to the same
 * version from both places. Then the redirected file runs exactly the code the
 * original would have. Anything that doesn't pass that check is left alone.
 */
import fs from 'fs'
import path from 'path'

const NM = `${path.sep}node_modules${path.sep}`

const readJson = (file) => {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch {
        return null
    }
}

/** `/x/node_modules/@a/b/lib/c.js` → `/x/node_modules/@a/b`, the package root of the innermost copy. */
function packageRoot(file) {
    const i = file.lastIndexOf(NM)
    if (i < 0) return null
    const rest = file.slice(i + NM.length).split(path.sep)
    const n = rest[0].startsWith('@') ? 2 : 1
    if (rest.length <= n) return null
    return file.slice(0, i + NM.length) + rest.slice(0, n).join(path.sep)
}

export default function dedupePackages() {
    const manifests = new Map() // root → package.json | null
    const canonical = new Map() // name@version → root
    const verdicts = new Map() // root → canonical root, or root itself when not deduped
    let redirected = 0
    const copies = new Set()

    const manifest = (root) => {
        if (!manifests.has(root)) manifests.set(root, readJson(path.join(root, 'package.json')))
        return manifests.get(root)
    }

    /** The version of `dep` that Node's resolution would find starting from `root`. */
    const depVersion = (root, dep) => {
        let dir = root
        for (;;) {
            const m = manifest(path.join(dir, 'node_modules', dep))
            if (m) return m.version
            const parent = path.dirname(dir)
            if (parent === dir) return null
            dir = parent
        }
    }

    const sameDependencies = (a, b, pkg) => {
        const deps = Object.keys(Object.assign({}, pkg.dependencies, pkg.peerDependencies, pkg.optionalDependencies))
        return deps.every((d) => depVersion(a, d) === depVersion(b, d))
    }

    const target = (root) => {
        if (verdicts.has(root)) return verdicts.get(root)
        const pkg = manifest(root)
        let result = root
        if (pkg?.name && pkg.version) {
            const key = `${pkg.name}@${pkg.version}`
            const first = canonical.get(key)
            if (!first) canonical.set(key, root)
            else if (first !== root && sameDependencies(first, root, pkg)) result = first
        }
        verdicts.set(root, result)
        return result
    }

    return {
        name: 'avxto:dedupe-packages',
        apply: 'build',
        enforce: 'pre',
        async resolveId(source, importer, options) {
            if (source.startsWith('\0')) return null
            const resolved = await this.resolve(source, importer, Object.assign({}, options, { skipSelf: true }))
            if (!resolved || resolved.external || !resolved.id.includes(NM)) return resolved
            const [file, query = ''] = resolved.id.split('?')
            const root = packageRoot(file)
            if (!root) return resolved
            const into = target(root)
            if (into === root) return resolved
            redirected++
            copies.add(root)
            return Object.assign({}, resolved, { id: into + file.slice(root.length) + (query ? `?${query}` : '') })
        },
        buildEnd() {
            if (copies.size) this.info(`bundled ${copies.size} duplicate package copies once (${redirected} imports redirected)`)
        },
    }
}
