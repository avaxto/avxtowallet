<template>
    <div class="flex-row utxo">
        <div class="flex-row addresses">
            <p>{{ isSent ? 'to' : 'from' }}</p>
            <div class="flex-column">
                <p v-for="addr in addresses" :key="addr" class="address">{{ addr }}</p>
            </div>
        </div>
        <p :sent="isSent" class="token">
            <span v-if="isSent">-</span>
            {{ amountString }} {{ symbol }}
        </p>
    </div>
</template>
<script lang="ts">
import { defineComponent, computed } from 'vue'
import { Utxo } from '@avalabs/glacier-sdk'
import { BN } from 'avalanche'
import { bnToLocaleString } from '@avalabs/avalanche-wallet-sdk'

interface Props {
    utxo: Utxo
    ins: Utxo[]
    outs: Utxo[]
    isSent: boolean
}

export default defineComponent({
    name: 'BaseTxUtxo',
    props: {
        utxo: {
            type: Object as () => Utxo,
            required: true
        },
        ins: {
            type: Array as () => Utxo[],
            required: true
        },
        outs: {
            type: Array as () => Utxo[],
            required: true
        },
        isSent: {
            type: Boolean,
            required: true
        }
    },
    setup(props: Props) {
        const amountString = computed(() => {
            return bnToLocaleString(new BN(props.utxo.asset.amount), denomination.value)
        })

        const symbol = computed(() => {
            return props.utxo.asset.symbol
        })

        const denomination = computed(() => {
            return props.utxo.asset.denomination
        })

        /**
         * Trim the address and prepend X-
         * @param address
         */
        const formatAddress = (address: string) => {
            const len = address.length
            return `X-${address.slice(0, 9)}..${address.slice(len - 5)}`
        }

        const addresses = computed(() => {
            // If this is a sent utxo, get who we sent to
            if (props.isSent) {
                return props.utxo.addresses.map(formatAddress)
            }
            // If received, get who sent this to us
            else {
                const insUtxos = props.ins.filter((utxo) => {
                    return utxo.asset.assetId === props.utxo.asset.assetId
                })
                return insUtxos
                    .map((utxo) => utxo.addresses)
                    .flat()
                    .map(formatAddress)
            }
        })

        return {
            amountString,
            symbol,
            denomination,
            formatAddress,
            addresses
        }
    }
})
</script>
<style scoped lang="scss">
.utxo {
    justify-content: space-between;
}
.addresses {
    p {
        overflow: hidden;
        color: var(--primary-color-light);
        white-space: nowrap;
        font-size: 12px;
        line-height: 12px;
        font-family: monospace;
        text-overflow: ellipsis;
    }

    .address {
        //max-width: 5em;
        word-break: break-all;
        padding-left: 0.5em;
    }
}

.token {
    text-align: right;
    white-space: nowrap;
    font-size: 15px;
    color: var(--success);

    &[sent] {
        color: #d04c4c;
    }
}
</style>
