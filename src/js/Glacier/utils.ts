import { GLACIER_CONCURRENCY, GLACIER_MAX_ADDRESSES } from '@/helpers/apiLimits'

export function cleanAddrs(addresses: string[]) {
    return addresses.map((addr) => addr.split('-')[1] || addr)
}

export function splitToParts<ArrayType>(array: ArrayType[], size: number) {
    if (!size) return [array]
    const parts = []
    const copy = [...array]
    while (copy.length) {
        parts.push(copy.splice(0, size))
    }
    return parts
}

/**
 * Runs `fn` over `addresses` in batches of the most Glacier accepts per call
 * (GLACIER_MAX_ADDRESSES), with at most GLACIER_CONCURRENCY in flight — big
 * batches, but never a burst. Results come back in batch order.
 */
export async function mapGlacierBatches<T>(addresses: string[], fn: (batch: string[]) => Promise<T>): Promise<T[]> {
    const parts = splitToParts<string>(addresses, GLACIER_MAX_ADDRESSES)
    const out: T[] = new Array(parts.length)
    let next = 0
    const worker = async () => {
        while (next < parts.length) {
            const i = next++
            out[i] = await fn(parts[i])
        }
    }
    await Promise.all(Array.from({ length: Math.min(GLACIER_CONCURRENCY, parts.length) }, worker))
    return out
}
