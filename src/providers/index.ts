import { AvaNetwork } from '../js/AvaNetwork'
import { connectPollingX } from '@/providers/polling_x'
import { connectPollingC } from '@/providers/polling_c'
import { pollingManager } from '@/providers/polling_manager'
import { PROVIDER_CONFIG } from '@/providers/provider_config'

export function setSocketNetwork(network: AvaNetwork) {
    if (PROVIDER_CONFIG.usePolling) {
        // Use new polling manager (preferred approach)
        pollingManager.startPolling(network)
    } else {
        // Original WebSocket implementation
        const { connectSocketX } = require('./socket_x')
        const { connectSocketC } = require('./socket_c')
        connectSocketX(network)
        connectSocketC(network)
    }
}

// Compatibility function for updateFilterAddresses calls
export function updateFilterAddresses() {
    if (PROVIDER_CONFIG.usePolling) {
        // For polling mode, no need to update filters - polling handles everything
        // This is a no-op for compatibility with existing code
    } else {
        // Original WebSocket implementation
        const { updateFilterAddresses: originalUpdateFilterAddresses } = require('./socket_x')
        originalUpdateFilterAddresses()
    }
}

// Export socket functions (original WebSocket implementation)
export * from './socket_x'
export * from './socket_c'

// Export polling functions (new REST API implementation)
export { connectPollingX, stopPollingX, updatePollingFilterAddresses } from './polling_x'
export { connectPollingC, stopPollingC, updatePollingSubscriptions } from './polling_c'
export { pollingManager } from './polling_manager'
export { PROVIDER_CONFIG } from './provider_config'
