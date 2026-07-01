<template>
    <div class="evm_tx_row" :is-out="isOut">
        <p class="action_title">
            <span class="method_label">{{ methodLabel }}</span>
            <span v-if="valueLabel" class="value_label">{{ valueLabel }} AVAX</span>
        </p>
        <div class="address_row">
            <span class="addr_label">From</span>
            <span class="addr">{{ fromLabel }}</span>
            <span class="arr">→</span>
            <span class="addr_label">To</span>
            <span class="addr">{{ toLabel }}</span>
        </div>
        <div v-if="erc20Transfers.length" class="erc20_transfers">
            <div v-for="(t, i) in erc20Transfers" :key="i" class="erc20_transfer">
                <span class="erc20_symbol">{{ tokenSymbol(t) }}</span>
                <span class="erc20_value">{{ formatErc20(t.value, tokenDecimals(t)) }}</span>
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

        // Known 4-byte selectors → friendly labels, so contract calls without a
        // decoded methodName still read meaningfully.
        const SELECTORS: Record<string, string> = {
            '0xa9059cbb': 'Transfer',
            '0x23b872dd': 'Transfer From',
            '0x095ea7b3': 'Approve',
            '0x2e1a7d4d': 'Withdraw',
            '0xd0e30db0': 'Deposit',
            '0x42842e0e': 'Safe Transfer',
        }

        // Null-safe views over the raw (possibly incomplete) Glacier payload.
        const nt = computed((): any => props.transaction?.nativeTransaction || {})
        const fromAddr = computed((): string => nt.value.from?.address || '')
        const toAddr = computed((): string => nt.value.to?.address || '')
        const method = computed((): any => nt.value.method || {})

        const walletAddress = computed((): string => {
            const wallet = mainStore.activeWallet as any
            const raw = (wallet?.ethAddress ?? wallet?.getEvmAddress?.() ?? '').toString()
            const hex = raw.startsWith('0x') ? raw : '0x' + raw
            return hex.toLowerCase()
        })

        const isOut = computed((): boolean => {
            const from = fromAddr.value.toLowerCase()
            return !!from && from === walletAddress.value
        })

        const isCreation = computed((): boolean => {
            return method.value.callType === 'CONTRACT_CREATION' || (!toAddr.value && !!fromAddr.value)
        })

        const methodLabel = computed((): string => {
            const m = method.value
            if (isCreation.value) return 'Contract Deployment'
            if (m.callType === 'NATIVE_TRANSFER') return isOut.value ? 'Send' : 'Receive'
            // Prefer a decoded method name (strip the parameter signature).
            const name = m.methodName || m.name
            if (name && name !== 'Native Transfer') return prettify(String(name).split('(')[0])
            if (m.methodHash && SELECTORS[m.methodHash]) return SELECTORS[m.methodHash]

            const raw = nt.value.value
            const isZero = !raw || raw === '0' || raw === '0x0' || Number(raw) === 0
            if (!isZero) return isOut.value ? 'Send' : 'Receive'
            return m.methodHash ? 'Contract Call' : 'Contract Interaction'
        })

        const prettify = (s: string): string => {
            // camelCase / snake_case method name → Title Case words.
            const spaced = s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ')
            return spaced.charAt(0).toUpperCase() + spaced.slice(1)
        }

        const valueLabel = computed((): string | null => {
            const raw = nt.value.value
            if (raw === undefined || raw === null || raw === '' || raw === '0' || raw === '0x0') {
                return null
            }
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

        const fromLabel = computed((): string => {
            const name = nt.value.from?.name
            return name || shortAddr(fromAddr.value) || '—'
        })

        const toLabel = computed((): string => {
            if (isCreation.value) return toAddr.value ? shortAddr(toAddr.value) : 'New contract'
            const name = nt.value.to?.name
            return name || shortAddr(toAddr.value) || '—'
        })

        const erc20Transfers = computed((): any[] => {
            return Array.isArray(props.transaction?.erc20Transfers)
                ? props.transaction.erc20Transfers
                : []
        })

        const tokenSymbol = (t: any): string => {
            const tok = t?.erc20Token || {}
            return tok.symbol || tok.name || shortAddr(tok.address || '') || 'Token'
        }

        const tokenDecimals = (t: any): number => {
            const d = t?.erc20Token?.decimals
            return typeof d === 'number' ? d : 18
        }

        const formatErc20 = (rawValue: string, decimals?: number): string => {
            try {
                const dec = decimals ?? 18
                const val = new Big(rawValue).div(new Big(10).pow(dec))
                return val.toFixed(4).replace(/\.?0+$/, '')
            } catch {
                return rawValue ?? ''
            }
        }

        return {
            isOut,
            methodLabel,
            valueLabel,
            fromLabel,
            toLabel,
            erc20Transfers,
            tokenSymbol,
            tokenDecimals,
            formatErc20,
        }
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
