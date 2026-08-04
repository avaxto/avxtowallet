import {
    KeyChain as AVMKeyChain,
    KeyPair as AVMKeyPair,
    UTXOSet as AVMUTXOSet,
} from '@/avalanche/apis/avm'

import { UTXOSet as PlatformUTXOSet } from '@/avalanche/apis/platformvm'
import { getPreferredHRP } from '@/avalanche/utils'
import { ava, avm, bintools, pChain } from '@/AVA'
import HDKey from 'hdkey'
import { Buffer } from '@/avalanche'
import {
    KeyChain as PlatformVMKeyChain,
    KeyPair as PlatformVMKeyPair,
} from '@/avalanche/apis/platformvm'
import { pinia, useNetworkStore } from '@/stores'

import { AvaNetwork } from '@/js/AvaNetwork'
import { ChainAlias } from './wallets/types'
import { avmGetAllUTXOs, platformGetAllUTXOs } from '@/helpers/utxo_helper'
import { listChainsForAddresses } from '@/js/Glacier/listChainsForAddresses'

const INDEX_RANGE: number = 20 // a gap of at least 20 indexes is needed to claim an index unused
const SCAN_SIZE: number = 100 // the total number of utxos to look at initially to calculate last index
const SCAN_RANGE: number = SCAN_SIZE - INDEX_RANGE // How many items are actually scanned

// Default for the fast initial-scan heuristic (see fastScanCheck()). If this
// share of the last SCAN_SIZE addresses have no UTXOs, the wallet is treated
// as sparsely used and the normal (potentially multi-round, and for the
// explorer path much larger per-request) hd scan is skipped entirely.
const FAST_SCAN_EMPTY_THRESHOLD_DEFAULT: number = 0.6

class HdHelper {
    chainId: ChainAlias
    keyChain: AVMKeyChain | PlatformVMKeyChain
    keyCache: {
        [index: number]: AVMKeyPair | PlatformVMKeyPair
    }
    addressCache: {
        [index: number]: string
    }
    hdCache: {
        [index: number]: HDKey
    }
    changePath: string
    masterKey: HDKey
    hdIndex: number
    utxoSet: AVMUTXOSet | PlatformUTXOSet
    isPublic: boolean
    isFetchingUTXOs: boolean // true if updating balance
    isInit: boolean // true if HD index is found

    // Configurable threshold for the fast initial-scan heuristic (0-1).
    fastScanEmptyThreshold: number = FAST_SCAN_EMPTY_THRESHOLD_DEFAULT

    constructor(
        changePath: string,
        masterKey: HDKey,
        chainId: ChainAlias = 'X',
        isPublic: boolean = false
    ) {
        this.changePath = changePath
        this.isFetchingUTXOs = false
        this.isInit = false

        this.chainId = chainId
        const hrp = getPreferredHRP(ava.getNetworkID())
        if (chainId === 'X') {
            this.keyChain = new AVMKeyChain(hrp, chainId)
            this.utxoSet = new AVMUTXOSet()
        } else {
            this.keyChain = new PlatformVMKeyChain(hrp, chainId)
            this.utxoSet = new PlatformUTXOSet()
        }

        this.keyCache = {}
        this.addressCache = {}
        this.hdCache = {}
        this.masterKey = masterKey
        this.hdIndex = 0
        this.isPublic = isPublic
        // this.oninit()
    }

    async oninit() {
        await this.findHdIndex()
    }

    // When the wallet connects to a different network
    // Clear internal data and scan again
    async onNetworkChange() {
        this.clearCache()
        this.isInit = false
        const hrp = getPreferredHRP(ava.getNetworkID())
        if (this.chainId === 'X') {
            this.keyChain = new AVMKeyChain(hrp, this.chainId)
            this.utxoSet = new AVMUTXOSet()
        } else {
            this.keyChain = new PlatformVMKeyChain(hrp, this.chainId)
            this.utxoSet = new PlatformUTXOSet()
        }
        this.hdIndex = 0
        await this.oninit()
    }

    // Increments the hd index by one and adds the key
    // returns the new keypair
    incrementIndex(): number {
        const newIndex: number = this.hdIndex + 1

        if (!this.isPublic) {
            if (this.chainId === 'X') {
                const keychain = this.keyChain as AVMKeyChain
                const newKey = this.getKeyForIndex(newIndex) as AVMKeyPair
                keychain.addKey(newKey)
            } else {
                const keychain = this.keyChain as PlatformVMKeyChain
                const newKey = this.getKeyForIndex(newIndex) as PlatformVMKeyPair
                keychain.addKey(newKey)
            }
        }

        this.hdIndex = newIndex

        return newIndex
    }

    async findHdIndex() {

        const networkStore = useNetworkStore(pinia)
        const network: AvaNetwork | null = networkStore.selectedNetwork
        const explorerUrl = network?.explorerUrl

        console.log(`[HdHelper] findHdIndex ${this.chainId} path=${this.changePath} via ${explorerUrl ? explorerUrl : 'node'}`)

        // Fast path: one direct RPC call for the first SCAN_SIZE addresses.
        // If it confirms the wallet is sparsely used, skip the normal scan —
        // which, on the explorer path, otherwise queries in much larger
        // (512-address) rounds even for wallets that barely use any address.
        const fastIndex = await this.fastScanCheck()

        if (fastIndex !== null) {
            this.hdIndex = fastIndex
            console.log(
                `[HdHelper] findHdIndex ${this.chainId} path=${this.changePath} — ` +
                `fast scan confirmed sparse usage, skipping normal scan (hdIndex=${fastIndex})`
            )
        } else if (explorerUrl) {
            this.hdIndex = await this.findAvailableIndexExplorer()
        } else {
            this.hdIndex = await this.findAvailableIndexNode()
        }

        if (!this.isPublic) {
            this.updateKeychain()
        }
        this.isInit = true
        console.log(`[HdHelper] findHdIndex ${this.chainId} path=${this.changePath} done — hdIndex=${this.hdIndex}`)
    }

    // Fast pre-check for findHdIndex(): fetch UTXO existence for the first
    // SCAN_SIZE (100) addresses in a single batch, then walk the batch
    // backwards (from the highest index down) counting how many addresses
    // have no UTXOs. If at least `fastScanEmptyThreshold` (default 60%) of
    // the 100 addresses are unused, the wallet is almost certainly sparsely
    // used this far out. In that case resolve the hd index directly from
    // this one batch (reusing the same gap-of-INDEX_RANGE rule as the normal
    // scan) instead of running the full — and, on the explorer path, far
    // more expensive — scan.
    //
    // Returns the resolved index, or null if the threshold isn't met (or the
    // check itself fails), in which case the caller should fall back to the
    // normal scan.
    async fastScanCheck(): Promise<number | null> {
        try {
            const addrs = this.getAllDerivedAddresses(SCAN_SIZE - 1, 0)

            const utxoSet =
                this.chainId === 'X'
                    ? (await avm.getUTXOs(addrs)).utxos
                    : (await pChain.getUTXOs(addrs)).utxos

            let emptyCount = 0
            for (let i = addrs.length - 1; i >= 0; i--) {
                const addrBuf = bintools.parseAddress(addrs[i], this.chainId)
                const hasUtxos = utxoSet.getUTXOIDs([addrBuf]).length > 0
                if (!hasUtxos) emptyCount++
            }

            const emptyPct = emptyCount / addrs.length
            if (emptyPct < this.fastScanEmptyThreshold) {
                return null
            }

            // Threshold met — resolve the index from this same batch. If no
            // clean INDEX_RANGE gap exists within it (an unusual interleaved
            // pattern), fall back to the normal scan instead of guessing.
            return this.findGapStart(addrs, utxoSet)
        } catch (e) {
            console.warn(`[HdHelper] fastScanCheck ${this.chainId} path=${this.changePath} failed, falling back to normal scan:`, e)
            return null
        }
    }

    // Given a batch of addresses and their fetched UTXO set, find the index
    // (within the batch) where a run of INDEX_RANGE consecutive unused
    // addresses begins. Returns null if no such run exists in the batch.
    findGapStart(addrs: string[], utxoSet: AVMUTXOSet | PlatformUTXOSet): number | null {
        for (let i = 0; i < addrs.length - INDEX_RANGE; i++) {
            let gapSize = 0
            for (let n = 0; n < INDEX_RANGE; n++) {
                const addrBuf = bintools.parseAddress(addrs[i + n], this.chainId)
                if (utxoSet.getUTXOIDs([addrBuf]).length === 0) {
                    gapSize++
                } else {
                    i = i + n
                    break
                }
            }
            if (gapSize === INDEX_RANGE) return i
        }
        return null
    }

    // Fetches the utxos for the current keychain.
    //
    // Scans address space in lots of LOT_SIZE — *past* the cached hdIndex — instead
    // of stopping at hdIndex like the old implementation did.  Addresses ahead of
    // hdIndex may have received funds since findHdIndex last ran (e.g. someone sent
    // to a freshly-derived address from a different wallet/session), and the old
    // single `getAllDerivedAddresses()` call missed them entirely.
    //
    // Lot-scan terminates after MAX_EMPTY_LOTS consecutive empty lots, matching the
    // `_scanHdLot` pattern used by InjectedWallet for its Glacier-driven HD scan.
    // hdIndex is advanced if any lot turned up a used address past the previous
    // hdIndex so downstream consumers see the discovered range.
    async updateUtxos(): Promise<AVMUTXOSet | PlatformUTXOSet> {
        this.isFetchingUTXOs = true

        if (!this.isInit) {
            console.error('HD Index not found yet.')
        }

        const LOT_SIZE = 300
        const MAX_EMPTY_LOTS = 2

        let result: AVMUTXOSet | PlatformUTXOSet =
            this.chainId === 'X' ? new AVMUTXOSet() : new PlatformUTXOSet()

        let emptyLots = 0
        let addrIdx = 0
        let highestUsedIdx = -1

        while (emptyLots < MAX_EMPTY_LOTS) {
            const lotAddrs: string[] = []
            for (let i = 0; i < LOT_SIZE; i++) {
                lotAddrs.push(this.getAddressForIndex(addrIdx + i))
            }

            const lotSet =
                this.chainId === 'X'
                    ? await avmGetAllUTXOs(lotAddrs)
                    : await platformGetAllUTXOs(lotAddrs)

            if (lotSet.getAllUTXOs().length > 0) {
                // Merge produces a new set; cast keeps the union type alignment.
                result = (result as any).merge(lotSet)
                emptyLots = 0
                // Walk the lot backwards to find the highest index that actually
                // owns a UTXO (not just any address in the lot).
                for (let i = LOT_SIZE - 1; i >= 0; i--) {
                    const addrBuf = bintools.parseAddress(lotAddrs[i], this.chainId)
                    if (lotSet.getUTXOIDs([addrBuf]).length > 0) {
                        const idx = addrIdx + i
                        if (idx > highestUsedIdx) highestUsedIdx = idx
                        break
                    }
                }
            } else {
                emptyLots++
            }

            addrIdx += LOT_SIZE
        }

        this.utxoSet = result
        console.log(
            `[HdHelper] updateUtxos ${this.chainId} path=${this.changePath} done — ` +
            `${result.getAllUTXOs().length} UTXOs from lot-scan 0..${addrIdx - 1} ` +
            `(highestUsed=${highestUsedIdx}, prior hdIndex=${this.hdIndex})`
        )

        // Advance hdIndex to one past the highest discovered used index, so the
        // keychain and downstream "current address" logic stay in sync with
        // what's actually been used on chain.
        while (this.hdIndex <= highestUsedIdx) {
            this.incrementIndex()
        }

        this.isFetchingUTXOs = false
        return result
    }

    // Returns more addresses than the current index
    getExtendedAddresses() {
        const hdIndex = this.hdIndex
        return this.getAllDerivedAddresses(hdIndex + INDEX_RANGE)
    }

    // Not used?
    getUtxos(): AVMUTXOSet | PlatformUTXOSet {
        return this.utxoSet
    }

    // Updates the helper keychain to contain keys upto the HD Index
    updateKeychain(): AVMKeyChain | PlatformVMKeyChain {
        const hrp = getPreferredHRP(ava.getNetworkID())
        let keychain: AVMKeyChain | PlatformVMKeyChain

        if (this.chainId === 'X') {
            keychain = new AVMKeyChain(hrp, this.chainId)
        } else {
            keychain = new PlatformVMKeyChain(hrp, this.chainId)
        }

        for (let i: number = 0; i <= this.hdIndex; i++) {
            let key: AVMKeyPair | PlatformVMKeyPair
            if (this.chainId === 'X') {
                key = this.getKeyForIndex(i) as AVMKeyPair
                ;(keychain as AVMKeyChain).addKey(key)
            } else {
                key = this.getKeyForIndex(i) as PlatformVMKeyPair
                ;(keychain as PlatformVMKeyChain).addKey(key)
            }
        }
        this.keyChain = keychain
        return keychain
    }

    getKeychain() {
        return this.keyChain
    }

    // Returns all key pairs up to hd index
    getAllDerivedKeys(upTo = this.hdIndex): AVMKeyPair[] | PlatformVMKeyPair[] {
        const set: AVMKeyPair[] | PlatformVMKeyPair[] = []
        for (let i = 0; i <= upTo; i++) {
            if (this.chainId === 'X') {
                const key = this.getKeyForIndex(i) as AVMKeyPair
                ;(set as AVMKeyPair[]).push(key)
            } else {
                const key = this.getKeyForIndex(i) as PlatformVMKeyPair
                ;(set as PlatformVMKeyPair[]).push(key)
            }
        }
        return set
    }

    getAllDerivedAddresses(upTo = this.hdIndex, start = 0): string[] {
        const res = []
        for (let i = start; i <= upTo; i++) {
            const addr = this.getAddressForIndex(i)
            res.push(addr)
        }
        return res
    }

    clearCache() {
        this.keyCache = {}
        this.addressCache = {}
    }

    // Scans the address space of this hd path and finds the last used index using the
    // explorer API.
    async findAvailableIndexExplorer(startIndex = 0): Promise<number> {
        // The number of addresses to process and request from the explorer at a time
        const upTo = 512

        const addrs = this.getAllDerivedAddresses(startIndex + upTo, startIndex)
        const addrChainsGlacier = await listChainsForAddresses(addrs)
        const seenAddrs = addrChainsGlacier.map((addrData) => addrData.address)

        for (let i = 0; i < addrs.length - INDEX_RANGE; i++) {
            let gapSize: number = 0

            for (let n = 0; n < INDEX_RANGE; n++) {
                const scanIndex = i + n
                const scanAddr = addrs[scanIndex]

                const rawAddr = scanAddr.split('-')[1]

                const isSeen = seenAddrs.includes(rawAddr)
                if (!isSeen) {
                    // If doesn't exist on any chain
                    gapSize++
                } else {
                    i = i + n
                    break
                }
            }

            // If the gap is reached return the index
            if (gapSize === INDEX_RANGE) {
                return startIndex + i
            }
        }

        return await this.findAvailableIndexExplorer(startIndex + (upTo - INDEX_RANGE))
    }

    // Uses the node to find last used HD index
    // Only used when there is no explorer API available
    async findAvailableIndexNode(start: number = 0): Promise<number> {
        const addrs: string[] = []

        // Get keys for indexes start to start+scan_size
        for (let i: number = start; i < start + SCAN_SIZE; i++) {
            const address = this.getAddressForIndex(i)
            addrs.push(address)
        }

        let utxoSet

        if (this.chainId === 'X') {
            utxoSet = (await avm.getUTXOs(addrs)).utxos
        } else {
            utxoSet = (await pChain.getUTXOs(addrs)).utxos
        }

        // Scan UTXOs of these indexes and try to find a gap of INDEX_RANGE
        const gapStart = this.findGapStart(addrs, utxoSet)
        if (gapStart !== null) {
            return start + gapStart
        }
        return await this.findAvailableIndexNode(start + SCAN_RANGE)
    }

    getFirstAvailableIndex(): number {
        for (let i = 0; i < this.hdIndex; i++) {
            const addr = this.getAddressForIndex(i)
            const addrBuf = bintools.parseAddress(addr, this.chainId)
            const utxoIds = this.utxoSet.getUTXOIDs([addrBuf])
            if (utxoIds.length === 0) {
                return i
            }
        }

        return 0
    }

    // Returns the key of the first index that has no utxos
    getFirstAvailableAddress(): string {
        const idx = this.getFirstAvailableIndex()
        return this.getAddressForIndex(idx)
    }

    getCurrentKey(): AVMKeyPair | PlatformVMKeyPair {
        const index: number = this.hdIndex
        return this.getKeyForIndex(index)
    }

    getCurrentAddress(): string {
        const index = this.hdIndex
        return this.getAddressForIndex(index)
    }

    /**
     * Returns the PRIVATE keypair for an index. Only valid on a non-public helper.
     *
     * Public helpers must never reach this. Feeding a public key to
     * `keyChain.importKey` does NOT fail: importKey passes the bytes straight to
     * `ec.keyFromPrivate` with no length validation (see
     * avalanche/common/secp256k1.ts importKey), so elliptic reduces the 33-byte
     * public key mod n and hands back a valid-looking keypair for a completely
     * unrelated key — and therefore a wrong address. That silently produces
     * unspendable paper wallets and bogus "reveal private key" output, so fail
     * loudly instead. Callers that only need an address must use
     * getAddressForIndex(), which is public-safe.
     */
    getKeyForIndex(index: number): AVMKeyPair | PlatformVMKeyPair {
        if (this.isPublic) {
            throw new Error(
                'Cannot derive a private key from a public (watch-only) HD helper.'
            )
        }

        // If key is cached return that
        let cacheExternal: AVMKeyPair | PlatformVMKeyPair

        if (this.chainId === 'X') {
            cacheExternal = this.keyCache[index] as AVMKeyPair
        } else {
            cacheExternal = this.keyCache[index] as PlatformVMKeyPair
        }

        if (cacheExternal) return cacheExternal

        const derivationPath: string = `${this.changePath}/${index.toString()}`

        // Get key from cache, if not generate it
        let key: HDKey
        if (this.hdCache[index]) {
            key = this.hdCache[index]
        } else {
            key = this.masterKey.derive(derivationPath) as HDKey
            this.hdCache[index] = key
        }

        // Copy bytes directly into avalanche's Buffer class rather than round
        // tripping through a hex string — a JS string holding private key
        // material can never be zeroed out of memory.
        const pkBuf: Buffer = Buffer.from(key.privateKey)
        const keypair = this.keyChain.importKey(pkBuf)

        // save to cache
        this.keyCache[index] = keypair
        return keypair
    }

    getAddressForIndex(index: number): string {
        if (this.addressCache[index]) {
            return this.addressCache[index]
        }

        const derivationPath: string = `${this.changePath}/${index.toString()}`
        // let key: HDKey = this.masterKey.derive(derivationPath) as HDKey;

        // Get key from cache, if not generate it
        let key: HDKey
        if (this.hdCache[index]) {
            key = this.hdCache[index]
        } else {
            key = this.masterKey.derive(derivationPath) as HDKey
            this.hdCache[index] = key
        }

        const pkHex = key.publicKey.toString('hex')
        const pkBuff = Buffer.from(pkHex, 'hex')
        const hrp = getPreferredHRP(ava.getNetworkID())

        const chainId = this.chainId

        // No need for PlatformKeypair because addressToString uses chainID to decode
        const keypair = new AVMKeyPair(hrp, chainId)
        const addrBuf = AVMKeyPair.addressFromPublicKey(pkBuff)
        const addr = bintools.addressToString(hrp, chainId, addrBuf)

        this.addressCache[index] = addr
        return addr
    }

    // Given an address find the derived index
    findAddressIndex(addr: string): number | null {
        const addrs = this.getAllDerivedAddresses()
        const index = addrs.indexOf(addr)

        if (index < 0) return null
        return index
    }
}
export { HdHelper }
