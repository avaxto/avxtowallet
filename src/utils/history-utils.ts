/**
 * History and CSV export utility functions
 * These were previously in the Vuex store modules/history
 */

import { BN } from 'avalanche'
import { bnToBig } from '@/helpers/helper'

/**
 * Download a CSV file
 * @param content The CSV content (can include data URI encoding)
 * @param filename The name of the file to download (without .csv extension)
 */
export function downloadCSVFile(content: string, filename: string): void {
    const link = document.createElement('a')
    link.setAttribute('href', content)
    link.setAttribute('download', `${filename}.csv`)
    link.click()
}

/**
 * Create CSV content from rows
 * @param rows Array of row arrays (each inner array is a row of cells)
 * @returns CSV formatted string with data URI encoding
 */
export function createCSVContent(rows: any[][]): string {
    const csvString = rows
        .map(row => 
            row.map(cell => {
                // Escape quotes and wrap in quotes if needed
                if (typeof cell === 'string' && (cell.includes(',') || cell.includes('"') || cell.includes('\n'))) {
                    return `"${cell.replace(/"/g, '""')}"`
                }
                return cell
            }).join(',')
        )
        .join('\n')
    
    return 'data:text/csv;charset=utf-8,' + encodeURIComponent(csvString)
}

/**
 * Convert staking data to CSV row format
 * @param rowData Staking transaction data
 * @returns Array of values for CSV row
 */
export function stakingDataToCsvRow(rowData: any): any[] {
    return [
        rowData.txId || '',
        rowData.type || '',
        rowData.nodeID || '',
        rowData.stakeAmt || '',
        rowData.stakeDate || '',
        rowData.stakeDuration || '',
        rowData.rewardDate || '',
        rowData.rewardDateUnix || '',
        rowData.avaxPrice || '',
        rowData.rewardAmtAvax || '',
        rowData.rewardAmtUsd || '',
    ]
}

/**
 * Get output totals from transaction outputs
 * @param outs Transaction outputs
 * @returns Total as BN
 */
export function getOutputTotals(outs: any[]): BN {
    let tot = new BN(0)
    for (let i = 0; i < outs.length; i++) {
        const out = outs[i]
        const amt = out.amount ? new BN(out.amount) : new BN(0)
        tot = tot.add(amt)
    }
    return tot
}

/**
 * Get owned outputs from a list of outputs
 * @param outs All outputs
 * @param myAddrs Addresses owned by the wallet
 * @returns Filtered outputs owned by wallet
 */
export function getOwnedOutputs(outs: any[], myAddrs: string[]): any[] {
    return outs.filter(out => {
        const addrs = out.addresses || []
        for (let i = 0; i < addrs.length; i++) {
            if (myAddrs.includes(addrs[i])) {
                return true
            }
        }
        return false
    })
}

/**
 * Get reward outputs from transaction
 * @param tx Transaction data
 * @returns Reward outputs
 */
export function getRewardOuts(tx: any): any[] {
    if (!tx.outputs) return []
    return tx.outputs.filter((out: any) => out.rewardUtxo === true)
}

/**
 * Get stake amount from transaction
 * @param tx Transaction data
 * @returns Stake amount as BN
 */
export function getStakeAmount(tx: any): BN {
    if (!tx.outputs) return new BN(0)
    
    // Sum all staked outputs
    let total = new BN(0)
    for (const out of tx.outputs) {
        if (out.stake === true && out.amount) {
            total = total.add(new BN(out.amount))
        }
    }
    
    return total
}

/**
 * Interface for transaction data
 * This matches the structure used in the store
 */
export interface ITransactionData {
    id: string
    type: string
    timestamp: string
    fee?: string
    memo?: string
    inputs?: any[]
    outputs?: any[]
    [key: string]: any
}

/**
 * Interface for UTXO data
 */
export interface UTXO {
    txID: string
    outputIndex: number
    amount: string
    addresses: string[]
    [key: string]: any
}

/**
 * Interface for CSV row data for AVAX transfers
 */
export interface CsvRowAvaxTransferData {
    txId: string
    date: string
    type: string
    amount: string
    [key: string]: any
}
