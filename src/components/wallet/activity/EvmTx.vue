<template>
    <div class="evm_tx_row" :is-out="isOut">
        <p class="action_title">
            <span class="method_label">{{ methodLabel }}</span>
            <span v-if="valueLabel" class="value_label">{{ valueLabel }} AVAX</span>
        </p>
        <div class="address_row">
            <span class="addr_label">From</span>
            <span class="addr">{{ shortAddr(transaction.nativeTransaction.from.address) }}</span>
            <span class="arr">→</span>
            <span class="addr_label">To</span>
            <span class="addr">{{ shortAddr(transaction.nativeTransaction.to.address) }}</span>
        </div>
        <div v-if="transaction.erc20Transfers && transaction.erc20Transfers.length" class="erc20_transfers">
            <div
                v-for="(t, i) in transaction.erc20Transfers"
                :key="i"
                class="erc20_transfer"
            >
                <span class="erc20_symbol">{{ t.erc20Token.symbol ?? t.erc20Token.name }}</span>
                <span class="erc20_value">{{ formatErc20(t.value, t.erc20Token.decimals) }}</span>
            </div>
        </div>
    </div>
</template>

<script lang="ts">
import { defineComponent, computed } from 'vue'
import { EvmTransactionDetails } from '@/js/Glacier/models'
import Big from 'big.js'
import { useMainStore } from '@/stores'

export default defineComponent({
    name: 'EvmTx',
    props: {
        transaction: {
            type: Object as () => EvmTransactionDetails,
            required: true,
        },
    },
    setup(props) {
        const mainStore = useMainStore()

        const walletAddress = computed((): string => {
            const wallet = mainStore.activeWallet as any
            return ('0x' + (wallet?.ethAddress ?? '')).toLowerCase()
        })

        const isOut = computed((): boolean => {
            return (
                props.transaction.nativeTransaction.from.address.toLowerCase() ===
                walletAddress.value
            )
        })

        const methodLabel = computed((): string => {
            const m = props.transaction.nativeTransaction.method
            if (m?.name) return m.name
            const value = props.transaction.nativeTransaction.value
            const isZero = !value || value === '0' || value === '0x0'
            if (!isZero) return isOut.value ? 'Send' : 'Receive'
            return isOut.value ? 'Contract Call' : 'Contract Interaction'
        })

        const valueLabel = computed((): string | null => {
            const raw = props.transaction.nativeTransaction.value
            if (!raw || raw === '0' || raw === '0x0') return null
            try {
                const wei = BigInt(raw)
                if (wei === 0n) return null
                const avax = new Big(wei.toString()).div(new Big('1000000000000000000'))
                return avax.toFixed(6).replace(/\.?0+$/, '')
            } catch {
                return null
            }
        })

        const shortAddr = (addr: string): string => {
            if (!addr || addr.length < 10) return addr
            return addr.slice(0, 6) + '…' + addr.slice(-4)
        }

        const formatErc20 = (rawValue: string, decimals?: number): string => {
            try {
                const dec = decimals ?? 18
                const val = new Big(rawValue).div(new Big(10).pow(dec))
                return val.toFixed(4).replace(/\.?0+$/, '')
            } catch {
                return rawValue
            }
        }

        return { isOut, methodLabel, valueLabel, shortAddr, formatErc20 }
    },
})
</script>

<style scoped lang="scss">
.evm_tx_row {
    font-size: 13px;
    line-height: 1.5;
}

.action_title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
    margin-bottom: 2px;
}

.method_label {
    color: var(--primary-color);
}

.value_label {
    color: var(--secondary-color);
    font-size: 12px;
    font-weight: normal;
}

.address_row {
    display: flex;
    align-items: center;
    gap: 4px;
    color: var(--primary-color-light);
    font-size: 12px;
    font-family: monospace;
}

.addr_label {
    font-family: inherit;
    opacity: 0.6;
    font-size: 11px;
    text-transform: uppercase;
}

.arr {
    opacity: 0.4;
}

.erc20_transfers {
    margin-top: 4px;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
}

.erc20_transfer {
    display: flex;
    gap: 4px;
    background: var(--bg-light);
    border-radius: 3px;
    padding: 1px 6px;
    font-size: 11px;
}

.erc20_symbol {
    color: var(--secondary-color);
    font-weight: 600;
}

.erc20_value {
    color: var(--primary-color);
}
</style>
