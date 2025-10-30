/**
 * Configuration for provider mode
 */

import AVXTOConf from '@/avxto/AVXTOConf'

export interface ProviderConfig {
    pollingIntervals: {
        xChain: number // milliseconds
        cChain: number // milliseconds  
    }
    
}

export const DEFAULT_CONFIG: ProviderConfig = {    
    pollingIntervals: {
        xChain: AVXTOConf.X_CHAIN_POLLING_INTERVAL,  // 10 seconds for X-Chain
        cChain: AVXTOConf.C_CHAIN_POLLING_INTERVAL,  // 10 seconds for C-Chain (EVM blocks are faster)
    }
}

export const PROVIDER_CONFIG: ProviderConfig = {
    pollingIntervals: {
        xChain: AVXTOConf.X_CHAIN_POLLING_INTERVAL,
        cChain: AVXTOConf.C_CHAIN_POLLING_INTERVAL,
    }
}
