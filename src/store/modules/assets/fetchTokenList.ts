import { TokenList } from '@/store/modules/assets/types'
import localTokenList from '@/ERC20Tokenlist.json'

function mapTokenInfo(token: any) {
    return { ...token, logoURI: token.logoUri || token.logoURI }
}

/**
 * Fetch erc20 token information from Avalanche token repository
 * Falls back to local token list if fetch fails
 */
export async function fetchTokenList(): Promise<TokenList> {
    try {
        const res = await fetch(
            'https://raw.githubusercontent.com/ava-labs/avalanche-bridge-tokens/main/data/tokens.json'
        )
        
        if (!res.ok) {
            throw new Error(`HTTP error! status: ${res.status}`)
        }
        
        const json = await res.json()

        // Try to parse the new format (array with chainId)
        let tokensMainnet: any[] = []
        let tokensTestnet: any[] = []
        
        if (Array.isArray(json)) {
            tokensMainnet = json.filter((t: any) => t.chainId === 43114).map(mapTokenInfo)
            tokensTestnet = json.filter((t: any) => t.chainId === 43113).map(mapTokenInfo)
        } else if (json.tokens && Array.isArray(json.tokens)) {
            tokensMainnet = json.tokens.filter((t: any) => t.chainId === 43114).map(mapTokenInfo)
            tokensTestnet = json.tokens.filter((t: any) => t.chainId === 43113).map(mapTokenInfo)
        } else {
            // Fallback to local list
            console.warn('Unexpected token list format, using local fallback')
            return localTokenList as TokenList
        }

        return {
            name: 'Avalanche (C-Chain)',
            logoURI:
                'https://glacier-api.avax.network/proxy/chain-assets/3e1b653/chains/43113/token-logo.png',
            keywords: [],
            timestamp: '',
            url: '',
            readonly: true,
            version: {
                major: 1,
                minor: 0,
                patch: 0,
            },
            tokens: [...tokensMainnet, ...tokensTestnet],
        }
    } catch (error) {
        console.error('Failed to fetch token list from remote, using local fallback:', error)
        return localTokenList as TokenList
    }
}
