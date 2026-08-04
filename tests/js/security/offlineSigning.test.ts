import { createPinia, setActivePinia } from 'pinia'
import {
    useOfflineSigningStore,
    isOfflineTxId,
    OFFLINE_TX_ID,
} from '@/stores/offlineSigning'

describe('offlineSigning store', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
        localStorage.clear()
    })

    it('is inactive by default, so nothing is captured', () => {
        const s = useOfflineSigningStore()
        expect(s.isActive).toBe(false)
        expect(s.hasRecords).toBe(false)
    })

    it('activates from the global switch and persists it', () => {
        const s = useOfflineSigningStore()
        s.setEnabled(true)
        expect(s.isActive).toBe(true)
        expect(localStorage.getItem('offlineSigningEnabled')).toBe('true')

        s.setEnabled(false)
        expect(s.isActive).toBe(false)
        expect(localStorage.getItem('offlineSigningEnabled')).toBe('false')
    })

    it('activates from the per-operation override without persisting it', () => {
        const s = useOfflineSigningStore()
        s.setOneShot(true)
        expect(s.isActive).toBe(true)
        // A one-shot must never survive as a global preference.
        expect(localStorage.getItem('offlineSigningEnabled')).toBeNull()
    })

    it('captures records and returns a recognisable sentinel id', () => {
        const s = useOfflineSigningStore()
        s.setOneShot(true)

        const id = s.capture({
            label: 'Send AVAX',
            family: 'evm',
            chain: 'C',
            base64: 'AAEC',
        })

        expect(isOfflineTxId(id)).toBe(true)
        expect(id.startsWith(OFFLINE_TX_ID)).toBe(true)
        expect(s.records).toHaveLength(1)
        expect(s.records[0].base64).toBe('AAEC')
        expect(s.records[0].label).toBe('Send AVAX')
    })

    it('captures a batch in order, each with a distinct id', () => {
        const s = useOfflineSigningStore()
        s.setOneShot(true)

        const ids = ['a', 'b', 'c'].map((b64) =>
            s.capture({ label: `tx ${b64}`, family: 'evm', chain: 'C', base64: b64 })
        )

        expect(new Set(ids).size).toBe(3)
        expect(s.records.map((r) => r.base64)).toEqual(['a', 'b', 'c'])
    })

    it('endOperation clears the one-shot but keeps records for the page to show', () => {
        const s = useOfflineSigningStore()
        s.setOneShot(true)
        s.capture({ label: 'tx', family: 'avalanche', chain: 'X', base64: 'AA' })

        s.endOperation()

        expect(s.isActive).toBe(false)
        expect(s.records).toHaveLength(1)
    })

    it('a one-shot does not leak into the next operation', () => {
        const s = useOfflineSigningStore()
        s.setOneShot(true)
        s.endOperation()

        s.clearRecords()
        expect(s.isActive).toBe(false)

        // A second operation with no checkbox set must broadcast normally.
        expect(s.isActive).toBe(false)
    })

    it('endOperation leaves the global switch alone', () => {
        const s = useOfflineSigningStore()
        s.setEnabled(true)
        s.setOneShot(true)

        s.endOperation()

        // Global mode is sticky; only the per-operation override is released.
        expect(s.isActive).toBe(true)
        expect(s.isEnabled).toBe(true)
    })

    it('clearRecords empties the list', () => {
        const s = useOfflineSigningStore()
        s.setOneShot(true)
        s.capture({ label: 'tx', family: 'avalanche', chain: 'P', base64: 'AA' })
        expect(s.hasRecords).toBe(true)

        s.clearRecords()
        expect(s.hasRecords).toBe(false)
    })

    it('isOfflineTxId rejects real transaction ids', () => {
        expect(isOfflineTxId('2b3WtmnUSKx5STbhkTxMQ2W9AR1p6Ysxnw35MM9Qug8iY5r32f')).toBe(false)
        expect(isOfflineTxId('0xabc123')).toBe(false)
        expect(isOfflineTxId('')).toBe(false)
        expect(isOfflineTxId(null)).toBe(false)
        expect(isOfflineTxId(undefined)).toBe(false)
    })
})
