import { defineStore } from 'pinia'
import { ref } from 'vue'
import { web3 } from '@/evm'
import { AVXTO_CONTRACT_ADDRESS, C_CHAIN_POLLING_INTERVAL } from '@/avxto/AVXTOConf'
import { useMainStore } from './main'

// Minimal ERC20 ABI — only balanceOf
const ERC20_BALANCE_ABI = [
    {
        constant: true,
        inputs: [{ name: '_owner', type: 'address' }],
        name: 'balanceOf',
        outputs: [{ name: 'balance', type: 'uint256' }],
        type: 'function',
    },
] as const

export const useAvxtoStore = defineStore('avxto', () => {
    /** Raw AVXTO token balance as a string (in smallest unit / wei) */
    const avxtoBalance = ref<string>('0')

    /** Polling interval handle so we can stop it on logout */
    let pollHandle: ReturnType<typeof setInterval> | null = null

    /**
     * Fetch the AVXTO ERC20 token balance for the current wallet's C-chain address.
     */
    const fetchAvxtoBalance = async () => {
        const mainStore = useMainStore()
        const wallet = mainStore.activeWallet
        if (!wallet) {
            avxtoBalance.value = '0'
            return
        }

        const evmAddress = '0x' + wallet.getEvmAddress()
        if (!evmAddress || evmAddress === '0x') {
            avxtoBalance.value = '0'
            return
        }

        try {
            const contract = new web3.eth.Contract(ERC20_BALANCE_ABI as any, AVXTO_CONTRACT_ADDRESS)
            const balance: string = await contract.methods.balanceOf(evmAddress).call()
            avxtoBalance.value = balance.toString()
        } catch (e) {
            console.error('Failed to fetch AVXTO token balance:', e)
        }
    }

    /**
     * Start a background polling job that periodically refreshes the AVXTO balance.
     * Uses C_CHAIN_POLLING_INTERVAL from AVXTOConf (default 10 s).
     */
    const startPolling = () => {
        // Avoid duplicate intervals
        stopPolling()

        // Fetch immediately, then poll
        fetchAvxtoBalance()
        pollHandle = setInterval(fetchAvxtoBalance, C_CHAIN_POLLING_INTERVAL)
    }

    /**
     * Stop the background polling job (e.g. on logout).
     */
    const stopPolling = () => {
        if (pollHandle !== null) {
            clearInterval(pollHandle)
            pollHandle = null
        }
    }

    return {
        avxtoBalance,
        fetchAvxtoBalance,
        startPolling,
        stopPolling,
    }
})
