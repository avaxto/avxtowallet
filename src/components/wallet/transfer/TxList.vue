<template>
    <div>
        <div class="table_title">
            <p>{{ $t('transfer.tx_list.amount') }}</p>
            <p>{{ $t('transfer.tx_list.token') }}</p>
        </div>
        <div v-for="(tx, i) in tx_list" :key="tx.uuid" class="list_item">
            <currency-input-dropdown
                class="list_in"
                @change="oninputchange(i, $event)"
                :disabled_assets="disabledAssets[i]"
                :initial="tx.asset.id"
                :disabled="disabled"
            ></currency-input-dropdown>
            <button
                @click="removeTx(i)"
                v-if="(i !== 0 || tx_list.length > 1) && !disabled"
                class="remove_but"
            >
                <img src="@/assets/trash_can_dark.svg" />
            </button>
        </div>
        <button block depressed @click="addTx()" class="add_asset" v-if="showAdd">
            <fa icon="plus"></fa>
            Add Asset
        </button>
        <!--        <p class="chain_warn">{{$t('transfer.chain_warn')}}</p>-->
    </div>
</template>
<script lang="ts">
import 'reflect-metadata'
import { defineComponent, ref, computed, watch, onActivated, onDeactivated } from 'vue'
import { useStore } from '@/stores'
import { useRoute } from 'vue-router'
import { v1 as uuidv1 } from 'uuid'
import { BN } from 'avalanche'
import CurrencyInputDropdown from '@/components/misc/CurrencyInputDropdown.vue'
import AvaAsset from '@/js/AvaAsset'
import { AssetsDict } from '@/store/modules/assets/types'
import { ICurrencyInputDropdownValue, ITransaction } from '@/components/wallet/transfer/types'

export default defineComponent({
    name: 'TxList',
    components: {
        CurrencyInputDropdown,
    },
    props: {
        disabled: {
            type: Boolean,
            default: false
        }
    },
    emits: ['change'],
    setup(props, { emit }) {
        const store = useStore()
        const route = useRoute()
        
        const tx_list = ref<ITransaction[]>([])
        const disabledAssets = ref<AvaAsset[][]>([])
        const next_initial = ref<AvaAsset | null>(null)

        const assets_list = computed((): AvaAsset[] => {
            return store.getters['Assets/walletAssetsArray']
        })

        const assets = computed((): AssetsDict => {
            return store.getters['Assets/walletAssetsDict']
        })

        const showAdd = computed((): boolean => {
            if (props.disabled) return false
            if (tx_list.value.length === assets_list.value.length || assets_list.value.length === 0) {
                return false
            }
            return true
        })

        const updateUnavailable = (): void => {
            let res: AvaAsset[][] = []
            let allDisabled = []

            for (var i = 0; i < tx_list.value.length; i++) {
                let localDisabled: AvaAsset[] = []

                allDisabled.push(tx_list.value[i].asset)
                for (var n = 0; n < tx_list.value.length; n++) {
                    if (i === n) continue
                    let assetNow = tx_list.value[n].asset
                    localDisabled.push(assetNow)
                }
                res.push(localDisabled)
            }

            next_initial.value = null
            for (i = 0; i < assets_list.value.length; i++) {
                let asset = assets_list.value[i]
                if (!allDisabled.includes(asset)) {
                    next_initial.value = asset
                    break
                }
            }

            disabledAssets.value = res
        }

        const oninputchange = (index: number, event: ICurrencyInputDropdownValue): void => {
            let asset = event.asset
            let amt = event.amount

            if (!asset) return

            tx_list.value[index].asset = asset
            tx_list.value[index].amount = amt

            updateUnavailable()

            emit('change', tx_list.value)
        }

        const removeTx = (index: number): void => {
            tx_list.value.splice(index, 1)
            updateUnavailable()
            emit('change', tx_list.value)
        }

        const addTx = (id?: string): void => {
            if (tx_list.value.length >= assets_list.value.length) {
                return
            }

            let uuid = uuidv1()

            if (id) {
                tx_list.value.push({
                    uuid: uuid,
                    asset: assets.value[id],
                    amount: new BN(0),
                })
            } else if (next_initial.value) {
                tx_list.value.push({
                    uuid: uuid,
                    asset: next_initial.value,
                    amount: new BN(0),
                })
            }
            emit('change', tx_list.value)
        }

        // clears the list
        const clear = (): void => {
            for (var i = tx_list.value.length - 1; i >= 0; i--) {
                removeTx(i)
            }
        }

        const addDefaultAsset = () => {
            next_initial.value = assets_list.value[0]
            if (route.query.asset) {
                let assetId = route.query.asset as string
                addTx(assetId)
            } else {
                addTx()
            }
        }

        // clear and add the default asset
        const reset = () => {
            clear()
            addDefaultAsset()
        }

        onActivated(() => {
            reset()
        })

        onDeactivated(() => {
            reset()
        })

        watch(() => assets_list.value, () => {
            updateUnavailable()
        })

        return {
            tx_list,
            disabledAssets,
            next_initial,
            assets_list,
            assets,
            showAdd,
            updateUnavailable,
            oninputchange,
            removeTx,
            addTx,
            clear,
            addDefaultAsset,
            reset
        }
    }
})
</script>
<style scoped lang="scss">
@use '../../../main';

$right_pad: 60px;

.chain_warn {
    color: var(--primary-color-light);
    font-size: 12px;
    margin: 6px 0 !important;
}

.table_title {
    display: grid;
    grid-template-columns: 1fr 140px;
    padding-right: $right_pad;
}
.table_title p {
    display: block;
    text-align: left;
    font-weight: bold;
    padding: 12px 0;

    &:last-of-type {
        text-align: right;
    }
}
.table_title p:first-of-type {
    flex-grow: 1;
}

.list_item {
    position: relative;
    display: grid;
    grid-template-columns: 1fr $right_pad;
    /*flex-direction: column;*/
    margin-bottom: 14px;
    border-radius: 3px !important;

    &:last-of-type {
        margin-bottom: 0px;
    }

    .remove_but {
        height: 20px;
        opacity: 0.6;
        justify-self: center;

        &:hover {
            opacity: 1;
        }
        img {
            height: 100%;
            object-fit: contain;
        }
    }
}

.list_in {
    flex-grow: 1;
}

.list_item button {
    width: max-content;
    text-align: right;
    /*align-self: flex-end;*/
    font-size: 12px;
    color: var(--primary-color-light);
    margin-top: 10px;
    margin-bottom: 10px;

    &:hover {
        opacity: 0.7;
    }
}

.add_asset {
    width: calc(100% - #{$right_pad});
    border: 1px dashed var(--primary-color-light);
    margin-top: 10px;
    padding: 8px;
    border-radius: 0;
    color: var(--primary-color-light);
    font-size: 14px;
    opacity: 0.3;
    transition-duration: 0.2s;

    &:hover {
        opacity: 1;
        color: var(--primary-color);
    }
}

/*.list_item:before{*/
/*    content: '';*/
/*    position: absolute;*/
/*    height: 100%;*/
/*    width: 11px;*/
/*    border-right: 1px dashed #d2d2d2;*/
/*    opacity: 0.4;*/
/*}*/

.list_item[empty] button {
    opacity: 0.8;
}
.list_item[empty] .list_in,
.list_item[empty]:before {
    opacity: 0.1;
    transition-duration: 0.2s;
}
.list_item[empty] button:hover {
    opacity: 1;
}
.list_item[empty] .list_in {
    pointer-events: none;
}

@include main.mobile-device {
    .list_item {
        column-gap: 12px;
        grid-template-columns: 1fr max-content;
    }

    .add_asset {
        width: 100%;
    }
}
</style>
