import HDKey from 'hdkey'

/**
 * The installed hdkey exposes more than its bundled type definitions declare —
 * @types/hdkey was written for 0.7 and stops at fromMasterSeed/derive/toJSON.
 * These three are present on the real module (verified against the installed
 * prototype), so the casts are collected here rather than scattered as `as any`
 * at each call site.
 */
export interface HdNode extends HDKey {
    /** Overwrites the node's private key in place and detaches it. */
    wipePrivateData(): void
    /** Serialized xpub, preserving depth/index/parentFingerprint. */
    publicExtendedKey: string
}

/** Widens an HDKey to the full runtime surface. */
export function hd(node: HDKey): HdNode {
    return node as HdNode
}

/**
 * Rebuilds a node from a serialized extended key. Given an xpub this yields a
 * neutered node: it derives non-hardened children and public keys, and has no
 * private key at all.
 */
export function hdFromExtendedKey(extendedKey: string): HdNode {
    return (HDKey as unknown as {
        fromExtendedKey(key: string): HdNode
    }).fromExtendedKey(extendedKey)
}

/** Wipes a node's private data, tolerating nodes that never had any. */
export function wipeNode(node: HDKey | HdNode | null | undefined): void {
    if (!node) return
    try {
        hd(node).wipePrivateData()
    } catch {
        // Already neutered, or a node type without private data.
    }
}
