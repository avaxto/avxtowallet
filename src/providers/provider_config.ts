/**
 * Configuration for provider mode
 */

export interface ProviderConfig {
    pollingIntervals: {
        xChain: number // milliseconds
        cChain: number // milliseconds  
    }
    
}

export const DEFAULT_CONFIG: ProviderConfig = {    
    pollingIntervals: {
        xChain: 5000,  // 5 seconds for X-Chain
        cChain: 3000,  // 3 seconds for C-Chain (EVM blocks are faster)
    }
}

// Allow configuration to be overridden via environment variables
export const PROVIDER_CONFIG: ProviderConfig = {
    pollingIntervals: {
        xChain: parseInt(process.env.VUE_APP_X_CHAIN_POLLING_INTERVAL || '5000'),
        cChain: parseInt(process.env.VUE_APP_C_CHAIN_POLLING_INTERVAL || '3000'),
    }
}
