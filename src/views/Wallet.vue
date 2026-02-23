<template>
    <div class="wallet_view" ref="wallet_view">
        <UpdateKeystoreModal v-if="isManageWarning"></UpdateKeystoreModal>
        <transition name="fade" mode="out-in">
            <sidebar class="panel sidenav"></sidebar>
        </transition>
        <div class="wallet_main">
            <div>
                <NavbarMenu></NavbarMenu>
            </div>
            <div>
                <top-info class="wallet_top"></top-info>            
                <router-view id="wallet_router" v-slot="{ Component }">
                    <transition name="page_fade" mode="out-in">
                        <keep-alive
                            exclude="cross_chain,activity,advanced,earn,manage,studio">
                            <component :is="Component" :key="$route.path" />
                        </keep-alive>
                    </transition>
                </router-view>
            </div>            
        </div>        
    </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, onMounted, onBeforeUnmount, onUnmounted } from 'vue'
import { useMainStore } from '@/stores'
import { useRouter } from 'vue-router'
import TopInfo from '@/components/wallet/TopInfo.vue'
import Sidebar from '@/components/wallet/Sidebar.vue'
import UpdateKeystoreModal from '@/components/modals/UpdateKeystore/UpdateKeystoreModal.vue'
import NavbarMenu from '@/components/NavbarMenu.vue'

const TIMEOUT_DURATION = 60 * 7 // in seconds
const TIMEOUT_DUR_MS = TIMEOUT_DURATION * 1000

export default defineComponent({
    name: 'Wallet',
    components: {
        Sidebar,        
        TopInfo,
        UpdateKeystoreModal,
        NavbarMenu
    },
    setup() {
        const store = useMainStore()
        const router = useRouter()
        
        const wallet_view = ref<HTMLDivElement>()
        const intervalId = ref<ReturnType<typeof setTimeout> | null>(null)
        const logoutTimestamp = ref<number>(Date.now() + TIMEOUT_DUR_MS)
        const isLogOut = ref<boolean>(false)

        const isManageWarning = computed((): boolean => {
            if (store.warnUpdateKeyfile) {
                return true
            }
            return false
        })

        const hasVolatileWallets = computed(() => {
            return store.volatileWallets.length > 0
        })

        // Set the logout timestamp to now + TIMEOUT_DUR_MS
        const resetTimer = () => {
            logoutTimestamp.value = Date.now() + TIMEOUT_DUR_MS
        }

        const unload = (event: BeforeUnloadEvent) => {
            // user has no wallet saved
            if (!localStorage.getItem('w') && hasVolatileWallets.value && isLogOut.value) {
                event.preventDefault()
                isLogOut.value = false
                event.returnValue = ''
                router.push('/wallet/keys')
                resetTimer()
            }
        }

        onMounted(() => {
            resetTimer()

            let view = wallet_view.value as HTMLDivElement

            // @ts-ignore
            if (window.$posthog) {
                // @ts-ignore
                window.$posthog.capture('UserLoggedIn')
            }

            view.addEventListener('mousemove', resetTimer)
            view.addEventListener('mousedown', resetTimer)
            window.addEventListener('beforeunload', unload)
        })

        onBeforeUnmount(() => {
            let view = wallet_view.value as HTMLDivElement
            // Remove Event Listeners
            view.removeEventListener('mousemove', resetTimer)
            view.removeEventListener('mousedown', resetTimer)
            window.removeEventListener('beforeunload', unload)
        })

        onUnmounted(() => {
            if (intervalId.value) {
                clearInterval(intervalId.value)
            }
        })

        return {
            wallet_view,
            isManageWarning,
            hasVolatileWallets,
            resetTimer,
            
            unload
        }
    }
})
</script>

<style lang="scss" scoped>
@use '../main';

.wallet_view {
    padding-bottom: 0;
    display: grid;
    grid-template-columns: 200px 1fr;
    column-gap: 15px;
    height: 100%;
    background-color: var(--bg-wallet);
}

.sidenav {
    background-color: var(--bg-wallet-light);
}

.panel {
    overflow: auto;
    height: 100%;
}

.wallet_main {
    height: 100%;
    display: grid;
    grid-template-rows: max-content 1fr;
    grid-gap: 15px;
    padding-top: 8px;
}

#wallet_router {
    padding: 22px 20px;
    background-color: var(--bg-wallet-light);
    border-radius: 4px;
}

.page_fade-enter-active,
.page_fade-leave-active {
    transition: all 0.2s;
}
.page_fade-enter, .page_fade-leave-to /* .fade-leave-active below version 2.1.8 */ {
    opacity: 0;
    transform: translateY(30px);
}

@include main.mobile-device {
    .wallet_view {
        display: block;
        column-gap: 9px;
    }
    .wallet_main {
        grid-gap: 9px;
        padding-top: 0;
    }

    .wallet_sidebar {
        display: none;
    }
}

@include main.medium-device {
    .wallet_view {
        grid-template-columns: 180px 1fr !important;
        column-gap: 9px;
    }

    .wallet_main {
        grid-gap: 9px;
    }

    #wallet_router {
        padding: 12px 18px;
    }
}
</style>
