<template>
    <div class="search_address">
        <template v-if="selectedAddress">
            <p class="selected no_overflow_addr" @click="clearSelection">
                {{ selectedAddress }}
            </p>
        </template>
        <template v-else>
            <input
                type="text"
                v-model="address"
                @input="onInput"
                class="hover_border"
                placeholder="Search address.."
            />
            <div class="search_results" v-if="matchingAddrs.length > 0">
                <p
                    v-for="addr in matchingAddrs"
                    :key="addr"
                    @click="selectAddress(addr)"
                    class="no_overflow_addr"
                >
                    {{ addr }}
                </p>
            </div>
        </template>
    </div>
</template>
<script lang="ts">
import { defineComponent, ref, computed } from 'vue'
import MnemonicWallet from '@/js/wallets/MnemonicWallet'
import { LedgerWallet } from '@/js/wallets/LedgerWallet'

export default defineComponent({
    name: 'SearchAddress',
    props: {
        selectedAddress: {
            type: String as () => string | null,
            default: null
        },
        wallet: {
            type: Object as () => MnemonicWallet | LedgerWallet,
            required: true
        }
    },
    emits: ['change'],
    setup(props, { emit }) {
        const address = ref('')
        const matchingAddrs = ref<string[]>([])

        const addrsX = computed((): string[] => {
            return props.wallet.getAllDerivedExternalAddresses()
        })

        const addrsP = computed((): string[] => {
            return props.wallet.getAllAddressesP()
        })

        const emitChange = (val: string | null) => {
            emit('change', val)
        }

        const clearSelection = () => {
            address.value = ''
            matchingAddrs.value = []

            emitChange(null)
        }

        const selectAddress = (addr: string) => {
            emitChange(addr)
        }

        const onInput = () => {
            if (address.value === '') {
                matchingAddrs.value = []
                return
            }

            let pAddrs = addrsP.value.filter((addr) => {
                return addr.includes(address.value)
            })
            let xAddrs = addrsX.value.filter((addr) => {
                return addr.includes(address.value)
            })

            matchingAddrs.value = [...pAddrs.slice(0, 2), ...xAddrs.slice(0, 2)]
        }

        return {
            address,
            matchingAddrs,
            addrsX,
            addrsP,
            emitChange,
            clearSelection,
            selectAddress,
            onInput
        }
    }
})
</script>
<style scoped lang="scss">
$addrSize: 14px;

.search_address {
    position: relative;
}

.no_overflow_addr {
    text-overflow: ellipsis;
    overflow: hidden;
    white-space: nowrap;
    padding: 2px 6px;
    cursor: pointer;
    font-size: $addrSize;
    font-family: monospace;
}

input {
    width: 100%;
    background-color: rgba(0, 0, 0, 0.1);
    padding: 2px 6px;
    font-size: $addrSize;
    color: var(--primary-color);
}
.search_results {
    position: absolute;
    top: calc(100% - 1px);
    width: 100%;
    display: flex;
    flex-direction: column;
    background-color: var(--bg-light);
    border: 1px solid var(--bg);
    box-shadow: 0px 2px 5px rgba(0, 0, 0, 0.2);
    border-top: 0;

    p {
        cursor: pointer;
        &:hover {
            color: var(--secondary-color);
        }
    }
}

.selected {
    background-color: var(--secondary-color);
    color: #fff;
    border-radius: 4px;
}
</style>
