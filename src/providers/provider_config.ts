/**
 * Configuration for provider mode
 */

import { X_CHAIN_POLLING_INTERVAL, C_CHAIN_POLLING_INTERVAL, RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_MS } from '@/avxto/AVXTOConf'

export interface ProviderConfig {
    pollingIntervals: {
        xChain: number // milliseconds
        cChain: number // milliseconds  
    }
    rateLimit: {
        maxRequests: number // max requests allowed per window
        windowMs: number    // window duration in milliseconds
    }
}

export const DEFAULT_CONFIG: ProviderConfig = {    
    pollingIntervals: {
        xChain: X_CHAIN_POLLING_INTERVAL,  // 10 seconds for X-Chain
        cChain: C_CHAIN_POLLING_INTERVAL,  // 10 seconds for C-Chain (EVM blocks are faster)
    },
    rateLimit: {
        maxRequests: RATE_LIMIT_MAX_REQUESTS,
        windowMs: RATE_LIMIT_WINDOW_MS,
    }
}

export const PROVIDER_CONFIG: ProviderConfig = {
    pollingIntervals: {
        xChain: X_CHAIN_POLLING_INTERVAL,
        cChain: C_CHAIN_POLLING_INTERVAL,
    },
    rateLimit: {
        maxRequests: RATE_LIMIT_MAX_REQUESTS,
        windowMs: RATE_LIMIT_WINDOW_MS,
    }
}
