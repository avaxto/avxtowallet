<template>
    <div>
        <div class="header">
            <h1>{{ $t('studio.title') }}</h1>
            <h1 class="subtitle" v-if="pageNow">
                / {{ subtitle }}
                <span @click="cancel"><fa icon="times"></fa></span>
            </h1>
        </div>
        <template v-if="!pageNow">
            <p>{{ $t('studio.desc') }}</p>
            <div class="menu">
                <h2>{{ $t('studio.collectibles') }}</h2>
                <div class="options">
                    <div>
                        <h4 class="title">{{ $t('studio.menu1.title') }}</h4>
                        <p>{{ $t('studio.menu1.desc') }}</p>
                        <v-btn @click="goNewNftFamily" class="button_secondary" small depressed>
                            {{ $t('studio.menu1.submit') }}
                        </v-btn>
                    </div>
                    <div>
                        <h4 class="title">{{ $t('studio.menu2.title') }}</h4>
                        <p>{{ $t('studio.menu2.desc') }}</p>
                        <div>
                            <p v-if="!canMint" class="err">
                                {{ $t('studio.menu2.empty') }}
                            </p>
                            <v-btn
                                @click="goMint"
                                class="button_secondary"
                                small
                                depressed
                                :disabled="!canMint"
                            >
                                {{ $t('studio.menu2.submit') }}
                            </v-btn>
                        </div>
                    </div>
                </div>
            </div>
        </template>
        <Component v-else :is="pageNow" @cancel="cancel"></Component>
    </div>
</template>
<script lang="ts">
import { defineComponent, ref, computed, onActivated, onDeactivated } from 'vue'
import { useStore } from '@/stores'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import NewCollectibleFamily from '@/components/wallet/studio/NewCollectibleFamily.vue'
import MintNft from '@/components/wallet/studio/mint/MintNft.vue'
import { IWalletNftMintDict } from '@/store/types'
import Big from 'big.js'
import { bnToBig } from '@/helpers/helper'
import { avm } from '@/AVA'
import { BN } from 'avalanche'

export default defineComponent({
    name: 'studio',
    components: {
        NewCollectibleFamily,
    },
    setup() {
        const store = useStore()
        const route = useRoute()
        const router = useRouter()
        const { t } = useI18n()

        const pageNow = ref<any>(null)
        const subtitle = ref('')

        const goNewNftFamily = () => {
            pageNow.value = NewCollectibleFamily
            subtitle.value = 'New Collectible Family'
        }

        const goMint = () => {
            pageNow.value = MintNft
            subtitle.value = 'Mint Collectible'
        }

        const nftMintDict = computed((): IWalletNftMintDict => {
            return store.getters['Assets/nftMintDict']
        })

        const canMint = computed((): boolean => {
            const keys = Object.keys(nftMintDict.value)
            if (keys.length > 0) return true
            return false
        })

        // If url has a utxo id, clears it
        const clearUrl = () => {
            let utxoId = route.query.utxo

            if (utxoId) {
                router.replace({ query: null as any })
            }
        }

        const clearPage = () => {
            pageNow.value = null
            subtitle.value = ''
        }

        const cancel = () => {
            clearUrl()
            clearPage()
        }

        onDeactivated(() => {
            clearPage()
        })

        onActivated(() => {
            let utxoId = route.query.utxo

            if (utxoId) {
                goMint()
            }
        })

        return {
            pageNow,
            subtitle,
            goNewNftFamily,
            goMint,
            nftMintDict,
            canMint,
            clearUrl,
            clearPage,
            cancel
        }
    }
})
</script>
<style scoped lang="scss">
.header {
    display: flex;
    /*justify-content: space-between;*/
    /*align-items: center;*/
    align-items: center;

    h1 {
        font-weight: lighter;
    }

    .subtitle {
        margin-left: 0.5em;
        /*font-size: 20px;*/
        color: var(--primary-color-light);
        font-weight: lighter;
    }

    span {
        margin-left: 1em;

        &:hover {
            color: var(--primary-color);
            cursor: pointer;
        }
    }
}

.menu {
    h2 {
        margin: 20px 0;
        color: var(--primary-color-light);
        font-weight: normal;
        font-size: 2em;
    }
}

.options {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    column-gap: 14px;
    > div {
        border-radius: 4px;
        border: 1px solid var(--bg-light);
        background-color: var(--bg-light);
        padding: 30px;
        display: flex;
        flex-direction: column;

        &:hover {
            background-color: var(--bg-light);
        }
    }

    p {
        flex-grow: 1;
        margin: 12px 0 !important;
    }

    h4 {
        font-size: 32px !important;
        font-weight: lighter;
        color: var(--primary-color-light);
    }

    .v-btn {
        width: max-content;
    }
}
</style>
