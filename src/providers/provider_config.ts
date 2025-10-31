/**
 * Configuration for provider mode
 */

import { X_CHAIN_POLLING_INTERVAL, C_CHAIN_POLLING_INTERVAL } from '@/avxto/AVXTOConf'

export interface ProviderConfig {
    pollingIntervals: {
        xChain: number // milliseconds
        cChain: number // milliseconds  
    }
    
}

export const DEFAULT_CONFIG: ProviderConfig = {    
    pollingIntervals: {
        xChain: X_CHAIN_POLLING_INTERVAL,  // 10 seconds for X-Chain
        cChain: C_CHAIN_POLLING_INTERVAL,  // 10 seconds for C-Chain (EVM blocks are faster)
    }
}

export const PROVIDER_CONFIG: ProviderConfig = {
    pollingIntervals: {
        xChain: X_CHAIN_POLLING_INTERVAL,
        cChain: C_CHAIN_POLLING_INTERVAL,
    }
}
