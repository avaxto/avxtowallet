<template>
    <div class="wallet_view" ref="wallet_view">
        <UpdateKeystoreModal v-if="isManageWarning"></UpdateKeystoreModal>
        <transition name="fade" mode="out-in">
            <sidebar class="panel sidenav"></sidebar>
        </transition>
        <div class="wallet_main">
            <div>
                <NavbarMenu></NavbarMenu>
                <PlatformTabs></PlatformTabs>
            </div>
            <div class="wallet_content">
                <top-info class="wallet_top"></top-info>
                <router-view id="wallet_router" v-slot="{ Component }">
                    <transition name="page_fade" mode="out-in">
                        <keep-alive
                            exclude="cross_chain,activity,advanced,earn,manage,studio,iceberg,avxto">
                            <!--
                              Keyed by platform as well as path: several
                              platforms can be connected at once, and a cached
                              view instance is only valid for the one it was
                              built for. Without the platform in the key,
                              switching tabs would re-show the previous
                              platform's cached component.
                            -->
                            <component :is="Component" :key="`${$route.path}|${activePlatformId}`" />
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
import PlatformTabs from '@/components/wallet/PlatformTabs.vue'
import { useActivePlatformStore } from '@/platforms'
import { isScopeActive, onScopeClosed } from '@/js/security/session'

const TIMEOUT_DURATION = 60 * 7 // in seconds
const TIMEOUT_DUR_MS = TIMEOUT_DURATION * 1000
const IDLE_CHECK_MS = 15 * 1000

export default defineComponent({
    name: 'Wallet',
    components: {
        Sidebar,
        TopInfo,
        UpdateKeystoreModal,
        NavbarMenu,
        PlatformTabs
    },
    setup() {
        const store = useMainStore()
        const router = useRouter()
        const platformStore = useActivePlatformStore()
        const activePlatformId = computed(() => platformStore.activePlatformId)
        
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

        /**
         * Locks the wallet once the user has been idle past the timeout.
         *
         * This check previously did not exist — the timestamp and the mouse
         * listeners were wired up but nothing ever compared them, so the wallet
         * never actually locked.
         *
         * Never fires while an authorized operation is open: a long batch would
         * otherwise be killed mid-run with transactions already broadcast.
         * Instead the lock is deferred, and onScopeClosed runs it the moment the
         * operation finishes.
         */
        const lockPending = ref(false)

        const doLock = () => {
            lockPending.value = false
            store.logout()
        }

        const checkIdle = () => {
            if (Date.now() < logoutTimestamp.value) return
            if (isScopeActive()) {
                // Defer — an operation is signing right now.
                lockPending.value = true
                return
            }
            doLock()
        }

        // An operation finishing is also the point at which the idle clock
        // should restart: a batch that ran for nine minutes should not count
        // as nine minutes of idleness.
        const offScopeClosed = onScopeClosed(() => {
            if (lockPending.value) {
                doLock()
            } else {
                resetTimer()
            }
        })

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

            view.addEventListener('mousemove', resetTimer)
            view.addEventListener('mousedown', resetTimer)
            view.addEventListener('keydown', resetTimer)
            window.addEventListener('beforeunload', unload)

            intervalId.value = setInterval(checkIdle, IDLE_CHECK_MS)
        })

        onBeforeUnmount(() => {
            let view = wallet_view.value as HTMLDivElement
            // Remove Event Listeners
            view.removeEventListener('mousemove', resetTimer)
            view.removeEventListener('mousedown', resetTimer)
            view.removeEventListener('keydown', resetTimer)
            window.removeEventListener('beforeunload', unload)
            offScopeClosed()
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
            activePlatformId,
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
    display: grid;
    grid-gap: 15px;
    padding-top: 8px;
    align-content: start;
}

.wallet_content {
    display: flex;
    flex-direction: column;
}

#wallet_router {
    width: 100%;
    box-sizing: border-box;
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
