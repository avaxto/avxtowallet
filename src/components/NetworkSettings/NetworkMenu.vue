<template>
    <div
        data-cy="network-switcher"
        class="network_menu"
        :connected="status === 'connected' ? '' : null"
        @keydown.esc="closeMenu"
    >
        <div class="toggle_but" @click="toggleMenu" :testnet="isTestnet ? '' : null">
            <span
                :style="{
                    backgroundColor: connectionColor,
                }"
            ></span>
            <p v-if="activeNetwork">{{ activeNetwork.name }}</p>
            <p v-else>Disconnected</p>
            <!--            <template v-if="status === 'disconnected' || status === 'connecting'">-->
            <!--                <img v-if="$root.theme === 'day'" src="@/assets/network_off.png" />-->
            <!--                <img v-else src="@/assets/network_off_night.svg" />-->
            <!--            </template>-->
            <!--            <template v-else>-->
            <!--                <img v-if="$root.theme === 'day'" src="@/assets/network_on.png" />-->
            <!--                <img v-else src="@/assets/network_off_night.svg" />-->
            <!--            </template>-->
            <!--            <button v-if="status === 'connected'">-->
            <!--                {{ activeNetwork.name }}-->
            <!--            </button>-->
            <!--            <button v-else-if="status === 'connecting'">-->
            <!--                {{ $t('network.status1') }}-->
            <!--            </button>-->
            <!--            <button v-else>{{ $t('network.status2') }}</button>-->
        </div>
        <transition name="fade">
            <div class="network_dispose_bg" v-if="isActive" key="bg" @click="closeMenu"></div>
        </transition>
        <transition name="slide_right">
            <div class="network_body" v-if="isActive" key="body">
                <div class="header" data-cy="custom-network-option">
                    <template v-if="page === 'list'">
                        <h4>{{ $t('network.title') }}</h4>
                        <button
                            @click="viewCustom"
                            class="button_secondary"
                            data-cy="create-custom-option"
                        >
                            {{ $t('network.custom') }}
                        </button>
                    </template>
                    <template v-if="page === 'custom'">
                        <h4>{{ $t('network.title2') }}</h4>
                        <button @click="viewList" class="tab_cancel">
                            {{ $t('network.cancel') }}
                        </button>
                    </template>
                    <template v-if="page === 'edit'">
                        <h4>{{ $t('network.title3') }}</h4>
                        <button @click="viewList" class="tab_cancel">
                            {{ $t('network.cancel') }}
                        </button>
                    </template>
                </div>

                <transition name="fade" mode="out-in">
                    <div>
                        <ListPage v-if="page === 'list'" @edit="onedit"></ListPage>
                        <CustomPage v-if="page === 'custom'" @add="addCustomNetwork"></CustomPage>
                        <EditPage
                            v-if="page === 'edit'"
                            :net="editNetwork"
                            @success="networkUpdated"
                        ></EditPage>
                    </div>
                </transition>
            </div>
        </transition>
    </div>
</template>
<script lang="ts">
import { defineComponent, ref, computed } from 'vue'
import { useStore } from 'vuex'

import NetworkRow from './NetworkRow.vue'
import CustomPage from './CustomPage.vue'
import ListPage from './ListPage.vue'
import EditPage from '@/components/NetworkSettings/EditPage.vue'
import { AvaNetwork } from '@/js/AvaNetwork'
import { NetworkStatus } from '@/store/modules/network/types'

export default defineComponent({
    name: 'NetworkMenu',
    components: {
        ListPage,
        NetworkRow,
        CustomPage,
        EditPage,
    },
    setup() {
        const store = useStore()

        const page = ref('list')
        const isActive = ref(false)
        const editNetwork = ref<AvaNetwork | null>(null)

        const viewCustom = (): void => {
            page.value = 'custom'
        }

        const viewList = (): void => {
            page.value = 'list'
        }

        const closeMenu = (): void => {
            page.value = 'list'
            isActive.value = false
        }

        const toggleMenu = (): void => {
            isActive.value = !isActive.value
        }

        const addCustomNetwork = (data: AvaNetwork): void => {
            store.dispatch('Network/addCustomNetwork', data)
            page.value = 'list'
        }

        const connectionColor = computed((): string => {
            switch (status.value) {
                case 'connecting':
                    return '#ffaa00'
                case 'connected':
                    return '#0f0'
                default:
                    return '#f00'
            }
        })

        const networkUpdated = () => {
            page.value = 'list'
            store.dispatch('Network/save')
        }

        const onedit = (network: AvaNetwork): void => {
            editNetwork.value = network
            page.value = 'edit'
        }

        const status = computed((): NetworkStatus => {
            return store.state.Network.status
        })

        const activeNetwork = computed((): null | AvaNetwork => {
            return store.state.Network.selectedNetwork
        })

        const networks = computed((): AvaNetwork[] => {
            return store.getters('Network/allNetworks')
        })

        const isTestnet = computed((): boolean => {
            let net = activeNetwork.value

            if (!net) return false
            if (net.networkId !== 1) return true
            return false
        })

        return {
            page,
            isActive,
            editNetwork,
            viewCustom,
            viewList,
            closeMenu,
            toggleMenu,
            addCustomNetwork,
            connectionColor,
            networkUpdated,
            onedit,
            status,
            activeNetwork,
            networks,
            isTestnet
        }
    }
})
</script>
<style scoped lang="scss">
@use '../../main';

.network_menu {
    position: relative;
}

.toggle_but {
    //border: 2px solid var(--bg-light);
    padding: 2px 10px;
    //font-size: 13px;
    display: flex;
    border-radius: 6px;
    position: relative;
    align-items: center;
    cursor: pointer;

    &:hover {
        background-color: var(--bg-light);
    }

    $dotW: 8px;
    span {
        width: $dotW;
        height: $dotW;
        border-radius: $dotW;
        margin-right: 4px;
    }

    p {
        user-select: none;
    }

    button {
        outline: none !important;
    }

    img {
        max-height: 24px;
        object-fit: contain;
        margin-right: 5px;
    }

    &[testnet]:after {
        position: absolute;
        content: 'TEST';
        background-color: var(--secondary-color);
        color: #fff;
        font-size: 9px;
        font-weight: bold;
        padding: 2px 6px;
        border-radius: 12px;
        right: -20px;
        top: -8px;
    }
}

.tab_cancel {
    color: var(--primary-color);
}

.network_dispose_bg {
    position: fixed;
    z-index: 1;
    left: 0;
    top: 0;
    width: 100%;
    height: 100%;
    background-color: rgba(0, 0, 0, 0.6);
}

.network_body {
    position: fixed;
    z-index: 3;
    top: 0;
    right: 0;
    height: 100%;
    border: 1px solid var(--bg-light);
    border-radius: 4px;
    width: 340px;
    background-color: var(--bg);
    box-shadow: 2px 2px 10px rgba(0, 0, 0, 0.4);
}

.header {
    border-bottom: 1px solid var(--bg-light);
    padding: 10px 15px;
    display: flex;
    h4 {
        flex-grow: 1;
    }

    button {
        font-size: 12px;
        padding: 3px 14px;
        border-radius: 4px;
    }
}

.network_menu[connected] {
    .toggle_but {
        color: var(--primary-color);
    }
}

@media only screen and (max-width: main.$mobile_width) {
    .network_body {
        position: fixed;
        width: 100vw;
        z-index: 2;
        right: 0 !important;
        left: 0 !important;
    }
}

@include main.medium-device {
    .toggle_but {
        min-width: auto;
    }
}
</style>
