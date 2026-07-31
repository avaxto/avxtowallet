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
    // fee: BN

    constructor(
        name: string,
        url: string,
        networkId: number,
        explorerUrl?: string,
        explorerSiteUrl?: string,
        readonly = false
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
