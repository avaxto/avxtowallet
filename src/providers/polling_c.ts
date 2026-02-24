import { AvaNetwork } from '@/js/AvaNetwork'
import { pinia, useMainStore } from '@/stores'
import { WalletType } from '@/js/wallets/types'

/**
 * REST API equivalent of socket_c.ts  
 * Polls C-Chain for new blocks
 */

let pollingTimer: ReturnType<typeof setInterval> | null = null
let currentNetwork: AvaNetwork | null = null
let lastBlockNumber: number = 0
const POLLING_INTERVAL = 3000 // 3 seconds

export function connectPollingC(network: AvaNetwork) {
    // Stop any existing polling
    if (pollingTimer) {
        clearInterval(pollingTimer)
        pollingTimer = null
    }

    currentNetwork = network
    lastBlockNumber = 0
    
    // Start polling for C-Chain updates
    startCChainPolling()
}

function startCChainPolling() {
    if (!currentNetwork) return

    // Initial check
    checkForCChainUpdates()

    // Set up periodic polling
    pollingTimer = setInterval(() => {
        checkForCChainUpdates()
    }, POLLING_INTERVAL)
}

async function checkForCChainUpdates() {
    if (!currentNetwork) return

    try {
        const response = await fetch(currentNetwork.getFullURL() + '/ext/bc/C/rpc', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                jsonrpc: '2.0',
                method: 'eth_blockNumber',
                params: [],
                id: 1
            })
        })
        
        const data = await response.json()
        const currentBlockHex = data.result
        const currentBlockNumber = parseInt(currentBlockHex, 16)
        
        // Only update if we have a new block
        if (currentBlockNumber > lastBlockNumber) {
            lastBlockNumber = currentBlockNumber
            blockHeaderCallback()
        }
    } catch (error) {
        console.warn('C-Chain polling error:', error)
    }
}

function blockHeaderCallback() {
    updateWalletBalanceC()
}

function updateWalletBalanceC() {
    const mainStore = useMainStore(pinia)
    const wallet: null | WalletType = mainStore.activeWallet as WalletType | null
    if (!wallet) return
    
    // Refresh the wallet balance
    wallet.getEthBalance()
}

/**
 * Update subscription equivalent - for REST this starts/restarts polling
 */
export function updatePollingSubscriptions() {
    if (currentNetwork) {
        // Restart polling to ensure we're up to date
        startCChainPolling()
    }
}

// Stop polling when needed
export function stopPollingC() {
    if (pollingTimer) {
        clearInterval(pollingTimer)
        pollingTimer = null
    }
}
