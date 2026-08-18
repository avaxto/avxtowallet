import Web3 from 'web3'

/**
 * JSON-RPC over `fetch` provider for web3.
 *
 * web3's default HttpProvider uses XMLHttpRequest, which bypasses the global
 * rate limiter and its HTTP 429 detection entirely (both are installed on
 * `fetch` and axios). Routing web3 through `fetch` puts every eth_call /
 * eth_getBalance / eth_blockNumber under the same request budget as the rest
 * of the app and lets a 429 response trigger the global hard-block.
 */
export class FetchHttpProvider {
    host: string
    connected = true

    constructor(host: string) {
        this.host = host
    }

    send(payload: object, callback: (error: Error | null, result?: unknown) => void): void {
        fetch(this.host, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        })
            .then(async (res) => {
                // Include the host: without it, every RPC failure across
                // every network (this app talks to a dozen+ endpoints) reads
                // as the identical bare "HTTP 401" / "HTTP 500", with nothing
                // in the message pointing at which one — the previous wording
                // cost a manual test of every registry URL to track down a
                // Polygon RPC that had quietly started requiring an API key.
                if (!res.ok) {
                    throw new Error(`RPC request to ${this.host} failed: HTTP ${res.status}`)
                }
                return res.json()
            })
            .then((json) => callback(null, json))
            .catch((err) => callback(err))
    }

    supportsSubscriptions(): boolean {
        return false
    }

    disconnect(): boolean {
        return false
    }
}

const rpcUrl = `https://api.avax.network/ext/bc/C/rpc`
export const web3 = new Web3(new FetchHttpProvider(rpcUrl) as any)
