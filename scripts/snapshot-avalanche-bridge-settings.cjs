/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
*/
/*
 * Refreshes src/bridge/avalancheBridge/settingsSnapshot.json from the live
 * Avalanche Bridge settings. The live file only answers CORS for core.app, so
 * the wallet falls back to this copy when neither the same-origin proxy nor a
 * direct fetch works. Run it now and then:
 *     node scripts/snapshot-avalanche-bridge-settings.cjs
 * Only the fields the provider reads are kept.
 */
const fs = require('fs')
const path = require('path')

const URLS = [
    'https://avawarden-prod.s3.amazonaws.com/bridge_settings.json',
    'https://assets.warden-mainnet.avalanche.protofire.io/bridge_settings.json',
    'https://blob-storage-mainnet.warden-avascan.info/bridge_settings.json',
]
const OUT = path.join(__dirname, '../src/bridge/avalancheBridge/settingsSnapshot.json')
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o && o[k] !== undefined).map((k) => [k, o[k]]))

;(async () => {
    let raw
    for (const url of URLS) {
        try {
            const res = await fetch(url)
            if (res.ok) {
                raw = await res.json()
                break
            }
        } catch {}
    }
    if (!raw?.critical?.assets) throw new Error('Could not load the Avalanche Bridge settings.')
    const assets = {}
    for (const [symbol, a] of Object.entries(raw.critical.assets)) {
        assets[symbol] = pick(a, ['nativeContractAddress', 'wrappedContractAddress', 'denomination'])
    }
    const snapshot = {
        snapshotAt: new Date().toISOString(),
        critical: Object.assign(pick(raw.critical, ['operationMode', 'disableFrontend', 'walletAddresses', 'addressBlocklist']), { assets }),
        nonCritical: pick(raw.nonCritical, ['wrapFeeApproximation', 'unwrapFeeApproximation']),
    }
    fs.writeFileSync(OUT, JSON.stringify(snapshot, null, 2) + '\n')
    console.log(`Wrote ${path.relative(process.cwd(), OUT)} (${Object.keys(assets).length} assets).`)
})().catch((e) => {
    console.error(e.message)
    process.exit(1)
})
