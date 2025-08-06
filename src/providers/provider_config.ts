/**
 * Configuration for provider mode
 * Switch between WebSocket and REST API polling modes
 */

export interface ProviderConfig {
    usePolling: boolean
    pollingIntervals: {
        xChain: number // milliseconds
        cChain: number // milliseconds  
    }
    websocket: {
        reconnectTimeout: number // milliseconds
        maxReconnectAttempts: number
    }
}

export const DEFAULT_CONFIG: ProviderConfig = {
    usePolling: true, // Set to false to use WebSocket mode
    pollingIntervals: {
        xChain: 5000,  // 5 seconds for X-Chain
        cChain: 3000,  // 3 seconds for C-Chain (EVM blocks are faster)
    },
    websocket: {
        reconnectTimeout: 1000,
        maxReconnectAttempts: 5
    }
}

// Allow configuration to be overridden via environment variables
export const PROVIDER_CONFIG: ProviderConfig = {
    usePolling: process.env.VUE_APP_USE_POLLING !== 'false', // Default to true unless explicitly set to false
    pollingIntervals: {
        xChain: parseInt(process.env.VUE_APP_X_CHAIN_POLLING_INTERVAL || '5000'),
        cChain: parseInt(process.env.VUE_APP_C_CHAIN_POLLING_INTERVAL || '3000'),
    },
    websocket: {
        reconnectTimeout: parseInt(process.env.VUE_APP_WS_RECONNECT_TIMEOUT || '1000'),
        maxReconnectAttempts: parseInt(process.env.VUE_APP_WS_MAX_RECONNECT_ATTEMPTS || '5')
    }
}
