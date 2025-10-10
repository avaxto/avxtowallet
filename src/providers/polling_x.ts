import { AvaNetwork } from '@/js/AvaNetwork'
import store from '@/store'
import { WalletType } from '@/js/wallets/types'

/**
 * REST API equivalent of socket_x.ts
 * Polls X-Chain for updates
 */

let pollingTimer: ReturnType<typeof setInterval> | null = null
let currentNetwork: AvaNetwork | null = null
const POLLING_INTERVAL = 5000 // 5 seconds

export function connectPollingX(network: AvaNetwork) {
    // Stop any existing polling
    if (pollingTimer) {
        clearInterval(pollingTimer)
    }

    currentNetwork = network
    
    // Start polling for X-Chain updates
    startXChainPolling()
}

function startXChainPolling() {
    if (!currentNetwork) return

    // Initial check
    checkForXChainUpdates()

    // Set up periodic polling
    pollingTimer = setInterval(() => {
        checkForXChainUpdates()
    }, POLLING_INTERVAL)
}

async function checkForXChainUpdates() {
    if (!currentNetwork) return

    try {
        const response = await fetch(currentNetwork.getFullURL() + '/ext/bc/X', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                jsonrpc: '2.0',
                method: 'avm.getHeight',
                params: {},
                id: 1
            })
        })
        
        const data = await response.json()
        const currentHeight = data.result?.height
        
        // For now, trigger update on every poll
        // In production, you'd compare with last known height
        if (currentHeight) {
            updateWalletBalanceX()
        }
    } catch (error) {
        console.warn('X-Chain polling error:', error)
    }
}

function updateWalletBalanceX() {
    const wallet: null | WalletType = store.state.activeWallet
    if (!wallet) return
    
    // Refresh the wallet balance
    store.dispatch('Assets/updateUTXOsExternal').then(() => {
        store.dispatch('History/updateTransactionHistory')
    })
}

/**
 * Equivalent to updateFilterAddresses from socket_x.ts
 * For REST polling, this is handled differently - we just poll for all updates
 */
export function updatePollingFilterAddresses(): void {
    // In REST mode, we don't need to maintain address filters
    // We simply poll for updates and let the wallet update logic handle filtering
    const wallet: null | WalletType = store.state.activeWallet
    if (!wallet || !currentNetwork) {
        return
    }
    
    // Trigger an immediate check
    checkForXChainUpdates()
}

// Stop polling when needed
export function stopPollingX() {
    if (pollingTimer) {
        clearInterval(pollingTimer)
        pollingTimer = null
    }
}
