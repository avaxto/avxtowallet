/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
import { AvaNetwork } from '@/js/AvaNetwork'
import { pinia, useNetworkStore, useMainStore, useStatusBarStore, useAssetsStore, useHistoryStore } from '@/stores'
import { Wallet } from '@/js/wallets/AbstractWallet'
import { PROVIDER_CONFIG } from '@/providers/provider_config'
import { globalRateLimiter } from '@/providers/rate_limiter'
import { getNodeApiBase } from '@/providers/rpc_failover'

/**
 * Polling Manager
 * Periodic REST API calls polling
 */

interface PollingConfig {
    interval: number // milliseconds
    enabled: boolean
    lastBlockNumber?: number
    lastXChainHeight?: number
}

class PollingManager {
    private xChainConfig: PollingConfig = { 
        interval: PROVIDER_CONFIG.pollingIntervals.xChain, 
        enabled: false 
    }
    private cChainConfig: PollingConfig = { 
        interval: PROVIDER_CONFIG.pollingIntervals.cChain, 
        enabled: false 
    }
    private network: AvaNetwork | null = null
    
    private xChainTimer: ReturnType<typeof setInterval> | null = null
    private cChainTimer: ReturnType<typeof setInterval> | null = null

    /**
     * Start polling for both chains
     */
    startPolling(network: AvaNetwork) {
        this.network = network
        this.stopPolling() // Stop any existing polling first
        
        this.startXChainPolling()
        this.startCChainPolling()
    }

    /**
     * Stop all polling
     */
    stopPolling() {
        if (this.xChainTimer) {
            clearInterval(this.xChainTimer)
            this.xChainTimer = null
        }
        
        if (this.cChainTimer) {
            clearInterval(this.cChainTimer)
            this.cChainTimer = null
        }
        
        this.xChainConfig.enabled = false
        this.cChainConfig.enabled = false
    }

    /**
     * Start X-Chain polling
     */
    private startXChainPolling() {
        if (!this.network) return

        this.xChainConfig.enabled = true
        
        // Initial check
        this.checkXChainUpdates()
        
        // Set up periodic polling
        this.xChainTimer = setInterval(() => {
            if (this.xChainConfig.enabled) {
                this.checkXChainUpdates()
            }
        }, this.xChainConfig.interval)
    }

    /**
     * Start C-Chain polling
     */
    private startCChainPolling() {
        if (!this.network) return

        this.cChainConfig.enabled = true
        
        // Initial check
        this.checkCChainUpdates()
        
        // Set up periodic polling
        this.cChainTimer = setInterval(() => {
            if (this.cChainConfig.enabled) {
                this.checkCChainUpdates()
            }
        }, this.cChainConfig.interval)
    }

    /**
     * Check for X-Chain updates by polling blockchain height
     */
    private async checkXChainUpdates() {
        if (!this.network) return
        // Don't add poll traffic while the server is throttling us (429/503) —
        // every extra request extends the penalty window.
        if (globalRateLimiter.blocked || globalRateLimiter.paused) return

        try {
            const response = await fetch(getNodeApiBase(this.network.getFullURL()) + '/ext/bc/X', {
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
            
            if (currentHeight && currentHeight !== this.xChainConfig.lastXChainHeight) {
                this.xChainConfig.lastXChainHeight = currentHeight
                await this.updateWalletBalanceX()
            }
        } catch (error) {
            console.warn('X-Chain polling error:', error)
        }
    }

    /**
     * Check for C-Chain updates by polling latest block number
     */
    private async checkCChainUpdates() {
        if (!this.network) return
        // Skip poll ticks while throttled (see checkXChainUpdates).
        if (globalRateLimiter.blocked || globalRateLimiter.paused) return

        try {
            const response = await fetch(getNodeApiBase(this.network.getFullURL()) + '/ext/bc/C/rpc', {
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
            const currentBlock = parseInt(currentBlockHex, 16)
            
            if (currentBlock && currentBlock !== this.cChainConfig.lastBlockNumber) {
                this.cChainConfig.lastBlockNumber = currentBlock
                await this.updateWalletBalanceC()
            }
        } catch (error) {
            console.warn('C-Chain polling error:', error)
        }
    }

    /**
     * Update wallet balance for X-Chain (replaces xOnMessage functionality)
     */
    private async updateWalletBalanceX() {
        const wallet: null | Wallet = useMainStore(pinia).activeWallet
        if (!wallet) return

        try {
            // Refresh the wallet balance
            const before = wallet.utxoset.getUTXOIDs().sort().join(',')
            await useAssetsStore(pinia).updateUTXOsExternal()
            const after = wallet.utxoset.getUTXOIDs().sort().join(',')

            // The X-chain height moves with network-wide activity; only
            // refetch the (expensive) transaction history when this wallet's
            // own UTXO set actually changed.
            if (before !== after) {
                useHistoryStore(pinia).updateTransactionHistory()
            }
        } catch (error) {
            console.warn('X-Chain balance update error:', error)
        }
    }

    /**
     * Update wallet balance for C-Chain (replaces blockHeaderCallback functionality)
     */
    private async updateWalletBalanceC() {
        const wallet: null | Wallet = useMainStore(pinia).activeWallet
        if (!wallet) return

        try {
            // Refresh the native C-chain balance. The AVXTO (base asset)
            // ERC20 balance is NOT updated here — the avxto store polls it
            // on its own interval; doing it here too doubled the eth_calls.
            await wallet.getEthBalance()
        } catch (error) {
            console.warn('C-Chain balance update error:', error)
        }
    }

    /**
     * Update polling intervals
     */
    setPollingIntervals(xChainInterval?: number, cChainInterval?: number) {
        if (xChainInterval) {
            this.xChainConfig.interval = xChainInterval
            if (this.xChainConfig.enabled) {
                // Restart X-Chain polling with new interval
                if (this.xChainTimer) clearInterval(this.xChainTimer)
                this.startXChainPolling()
            }
        }

        if (cChainInterval) {
            this.cChainConfig.interval = cChainInterval
            if (this.cChainConfig.enabled) {
                // Restart C-Chain polling with new interval
                if (this.cChainTimer) clearInterval(this.cChainTimer)
                this.startCChainPolling()
            }
        }
    }

    /**
     * Get current status
     */
    getStatus() {
        return {
            xChain: {
                enabled: this.xChainConfig.enabled,
                interval: this.xChainConfig.interval,
                lastHeight: this.xChainConfig.lastXChainHeight
            },
            cChain: {
                enabled: this.cChainConfig.enabled,
                interval: this.cChainConfig.interval,
                lastBlock: this.cChainConfig.lastBlockNumber
            }
        }
    }
}

// Export singleton instance
export const pollingManager = new PollingManager()
