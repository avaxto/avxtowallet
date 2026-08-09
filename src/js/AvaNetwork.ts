import axios from 'axios'

let network_id: number = 0

class AvaNetwork {
    name: string
    id: number
    protocol: string
    port: number
    ip: string
    // Optional path prefix for providers that serve the node API under a
    // sub-path (e.g. OnFinality's https://host/public/ext/bc/X). Empty
    // string for providers serving from the root.
    basePath = ''
    networkId: number
    // chainId: string;
    url: string
    explorerUrl: string | undefined
    explorerSiteUrl: string | undefined
    readonly: boolean
    withCredentials = false
    // Whether this endpoint serves /ext/info at all. Public RPC backups
    // (PublicNode, OnFinality, ZAN…) only proxy the X/P/C chain APIs by
    // path and don't implement /ext/info — worse, they answer with a
    // wildcard 'Access-Control-Allow-Origin: *', which the browser refuses
    // to pair with a credentialed (withCredentials) request, so every probe
    // against them was a guaranteed CORS error in the console. Set false
    // for those so updateCredentials() skips the probe entirely instead of
    // provoking that failure on every connect.
    supportsInfoEndpoint: boolean
    // fee: BN

    constructor(
        name: string,
        url: string,
        networkId: number,
        explorerUrl?: string,
        explorerSiteUrl?: string,
        readonly = false,
        supportsInfoEndpoint = true
    ) {
        this.id = network_id++
        this.name = name
        this.explorerUrl = explorerUrl
        this.explorerSiteUrl = explorerSiteUrl
        this.protocol = 'http'
        this.port = 9650
        this.ip = 'localhost'
        this.url = url
        this.updateURL(url)
        this.networkId = networkId
        // this.chainId = chainId;
        this.readonly = readonly
        this.supportsInfoEndpoint = supportsInfoEndpoint
        // this.fee = new BN(0);
    }

    async testConnection(credentials = false) {
        const resp = await axios
            .post(
                this.url + '/ext/info',
                {
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'info.getNetworkID',
                },
                {
                    withCredentials: true,
                }
            )
            .catch((err) => {
                return false
            })

        return true
    }

    // Checks if this network endpoint allows credentials
    async updateCredentials() {
        if (!this.supportsInfoEndpoint) {
            this.withCredentials = false
            return
        }
        try {
            const res = await axios.post(
                this.url + '/ext/info',
                {
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'info.getNetworkID',
                },
                {
                    withCredentials: true,
                }
            )
            this.withCredentials = true
        } catch (e) {
            this.withCredentials = false
        }
    }

    updateURL(url: string) {
        const parsed = new URL(url)
        this.protocol = parsed.protocol.replace(':', '')
        this.ip = parsed.hostname
        this.port = parsed.port
            ? parseInt(parsed.port)
            : this.protocol === 'http'
            ? 80
            : 443
        // Keep any sub-path (e.g. OnFinality's /public), without a trailing slash
        this.basePath = parsed.pathname !== '/' ? parsed.pathname.replace(/\/+$/, '') : ''
    }
    getFullURL() {
        return `${this.protocol}://${this.ip}:${this.port}${this.basePath}`
    }

    getWsUrlX(): string {
        const protocol = this.protocol === 'https' ? 'wss' : 'ws'
        return `${protocol}://${this.ip}:${this.port}/ext/bc/X/events`
    }

    getWsUrlC(): string {
        const protocol = this.protocol === 'https' ? 'wss' : 'ws'
        return `${protocol}://${this.ip}:${this.port}/ext/bc/C/ws`
    }
}

export { AvaNetwork }
