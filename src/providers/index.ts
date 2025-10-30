import { AvaNetwork } from '../js/AvaNetwork'
import { pollingManager } from '@/providers/polling_manager'

export function setCurrentNetwork(network: AvaNetwork) {
        pollingManager.startPolling(network)    
}

// Compatibility function for updateFilterAddresses calls
export function updateFilterAddresses() {
    // TODO remove?    
}


// Export polling functions (new REST API implementation)
export { connectPollingX, stopPollingX, updatePollingFilterAddresses } from './polling_x'
export { connectPollingC, stopPollingC, updatePollingSubscriptions } from './polling_c'
export { pollingManager } from './polling_manager'
export { PROVIDER_CONFIG } from './provider_config'
