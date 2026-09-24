<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<!--
  The "AVXTO" dropdown — where to buy it.

  Extracted out of NavbarMenu.vue so the same menu can appear on the
  pre-login Home page, not only inside the logged-in wallet layout
  (NavbarMenu.vue is otherwise built around post-login state — isAvalanche,
  save/logout modals — none of which this menu needs). Both places render
  this component now, so the two link lists cannot drift.

  The button label is the one piece that does depend on login state: logged
  out, "AVXTO Required For Access" explains why the menu is even there on the
  home page; logged in, that framing no longer applies (access already
  happened) so it collapses to a plain "AVXTO", matching every other
  NavbarMenu dropdown's bare-word label.
-->
<template>
    <div class="avxto_menu_root">
        <v-menu offset-y>
            <template v-slot:activator="{ props }">
                <v-btn text v-bind="props" class="menu-btn">
                    <fa icon="coins" class="avxto_icon"></fa>
                    {{ isAuth ? 'AVXTO' : 'AVXTO Required For Access' }}
                </v-btn>
            </template>
            <v-list>
                <!--
                  `/wallet/swap` sits behind the `ifAuthenticated`
                  router guard (Swap.vue reads the active wallet's
                  held-token balances, so it has nothing to render
                  without a session) — a plain link to it while logged
                  out just bounces back to Home with no explanation.
                  So logged out, this doesn't navigate at all: it logs
                  the wallet in the same way the Navbar's own Connect
                  Wallet button does (one extension, every platform it
                  can open — see useInjectedConnect), and only THEN
                  lands on swap. Logged in, it's an ordinary link —
                  no extension round trip for a session that already
                  exists.

                  Gated on `!isConnecting` too, not `isAuth` alone:
                  `connectInjected` can sweep several platforms in one
                  pass (Core: Bitcoin/EVM/Solana), and `isAuth` goes
                  true the moment the FIRST of them connects —
                  Avalanche, typically, while EVM's own approval
                  prompt is still pending. Gating on `isAuth` alone
                  swaps this to the plain router-link right then, mid
                  -sweep, before the `router.push('/wallet/swap')` at
                  the end of the sweep has fired — which is exactly
                  what a first click that "does nothing" (but flips
                  the menu button to its logged-in label) was: the
                  connect kept running invisibly in the background,
                  and only the second click's ordinary router-link
                  actually navigated anywhere. Keeping this branch
                  shown until `isConnecting` itself goes false — which
                  happens only after the whole sweep, navigation
                  included, has settled — keeps the visible state
                  honest about what is actually still in flight.
                -->
                <v-list-item v-if="isAuth && !isConnecting" to="/wallet/swap">
                    <v-list-item-title>Get AVXTO Now</v-list-item-title>
                </v-list-item>
                <v-list-item v-else @click="connectThenSwap">
                    <v-list-item-title>
                        {{ isConnecting ? 'Connecting…' : 'Swap AVXTO' }}
                    </v-list-item-title>
                </v-list-item>
                <!-- Logged in only: the page needs a wallet to read a balance from. -->
                <v-list-item v-if="isAuth && !isConnecting" to="/wallet/moats/dashboard">
                    <v-list-item-title>AVXTO Moat Dashboard</v-list-item-title>
                </v-list-item>
                <v-list-item v-if="isAuth && !isConnecting" to="/wallet/moats/stake">
                    <v-list-item-title>Stake AVXTO (Moats)</v-list-item-title>
                </v-list-item>
                <v-list-item v-if="isAuth && !isConnecting" to="/wallet/moats/lock">
                    <v-list-item-title>Lock AVXTO (Moats)</v-list-item-title>
                </v-list-item>
                <v-list-item v-if="isAuth && !isConnecting" to="/wallet/moats/burn">
                    <v-list-item-title>Burn AVXTO (Moats)</v-list-item-title>
                </v-list-item>
                <!-- Moats link for reference -->
                
                <v-list-item
                    href="https://moats.app/moat/0xebe5fbacb882fd313d05684bef591c31f83b0524"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    <v-list-item-title>AVXTO Moat Page</v-list-item-title>
                </v-list-item>
                <v-list-item
                    href="https://lfj.gg/avalanche/trade/0xf56cecc07d97ac50630022cf84c19e612ae8c93d"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    <v-list-item-title>Buy AVXTO at LFJ</v-list-item-title>
                </v-list-item>
                
                <!--
                Not a plain link: ArenaTrade lists both Avalanche's and
                Robinhood's AVXTO under the same symbol at two
                different contract addresses, and buying on the wrong
                one is a real-money mistake that a hover-only tooltip
                is too easy to miss. Clicking opens the notice modal
                below instead of navigating; the link only opens once
                the user has actually seen it and pressed Proceed.
                -->
                <v-list-item @click="openArenaTradeNotice">
                    <v-list-item-title
                        title="In ArenaTrade make sure to switch to Avalanche mode to buy AVXTO. Robinhood CA is on a different address."
                    >
                        Buy AVXTO at ArenaTrade
                    </v-list-item-title>
                </v-list-item>

                <v-list-item
                    href="https://dexscreener.com/avalanche/0x2bdebde7e1088e42aafef104b5f7457aca5ab86f"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    <v-list-item-title>More info @ DEXScreener</v-list-item-title>
                </v-list-item>
            </v-list>
        </v-menu>

        <Modal ref="arenaTradeModalRef" title="Before you continue">
            <div class="arena_notice_body">
                <p>
                    In ArenaTrade make sure to switch to
                    <strong>Avalanche mode</strong>
                    to buy AVXTO. Robinhood CA is on a different address.
                </p>
                <img
                    :src="arenaTradeSelectImg"
                    alt="ArenaTrade chain selector with Avalanche checked, not Robinhood Chain"
                    class="arena_notice_img"
                />
                <div class="arena_notice_actions">
                    <v-btn class="ava_button button_primary" @click="proceedToArenaTrade">
                        Proceed
                    </v-btn>
                    <button class="ava_button_secondary" @click="closeArenaTradeNotice">
                        Cancel
                    </button>
                </div>
            </div>
        </Modal>
    </div>
</template>

<script lang="ts">
import { defineComponent, computed, ref } from 'vue'
import { useActivePlatformStore } from '@/platforms'
import { useInjectedConnect } from '@/composables/useInjectedConnect'
import Modal from '@/components/modals/Modal.vue'
import arenaTradeSelectImg from '@/assets/arenatrade-select.png'

const ARENATRADE_URL = 'https://arenatrade.ai/token/0xf56cecc07d97ac50630022cf84c19e612ae8c93d'

export default defineComponent({
    name: 'AvxtoMenu',
    components: { Modal },
    setup() {
        const platformStore = useActivePlatformStore()
        // Same check NavbarMenu.vue's own `isAuth` uses — platform-generic
        // rather than Avalanche's `mainStore.isAuth`, so this reads correctly
        // logged into the EVM platform too, not just Avalanche.
        const isAuth = computed(() => platformStore.activeWallet !== null)

        const { isConnecting, connectInjected } = useInjectedConnect()
        const connectThenSwap = () => connectInjected('/wallet/swap')

        const arenaTradeModalRef = ref<InstanceType<typeof Modal>>()

        const openArenaTradeNotice = (): void => {
            arenaTradeModalRef.value?.open()
        }

        const closeArenaTradeNotice = (): void => {
            arenaTradeModalRef.value?.close()
        }

        const proceedToArenaTrade = (): void => {
            window.open(ARENATRADE_URL, '_blank', 'noopener,noreferrer')
            closeArenaTradeNotice()
        }

        return {
            isAuth,
            isConnecting,
            connectThenSwap,
            arenaTradeSelectImg,
            arenaTradeModalRef,
            openArenaTradeNotice,
            closeArenaTradeNotice,
            proceedToArenaTrade,
        }
    },
})
</script>

<style scoped lang="scss">
@use '../main';

// Link rows are the link themselves (<a class="v-list-item">) — see the note
// atop NavbarMenu.vue's template for why a link inside the title was a bug.
// Bootstrap underlines and recolours every <a>, and Vuetify tints the row for
// the current route; both are put back to a plain menu item.
:deep(a.v-list-item) {
    color: var(--primary-color) !important;
    text-decoration: none !important;
}

:deep(.v-list-item--active > .v-list-item__overlay) {
    opacity: 0 !important;
}

.v-list-item-title {
    font-size: 14px !important;
}

// A wrapper element is required (single-root template) purely to hold the
// notice modal alongside the menu — it has no layout role of its own, so it
// must not become a visible flex item in NavbarMenu's row or disrupt Home's
// top bar the way an ordinary <div> would.
.avxto_menu_root {
    display: contents;
}

.avxto_icon {
    margin-right: 8px;
    font-size: 15px;
}

.arena_notice_body {
    width: 420px;
    max-width: 100%;
    padding: 30px;

    p {
        text-align: center;
        color: var(--primary-color);
        line-height: 1.6;
        margin: 0;
    }
}

// The chain-selector screenshot referenced in the notice text above — shows
// exactly which toggle in ArenaTrade's own UI to check, so "switch to
// Avalanche mode" isn't left to the reader's guess at where that control is.
.arena_notice_img {
    display: block;
    width: 100%;
    height: auto;
    margin-top: 16px;
    border-radius: 8px;
    border: 1px solid var(--bg-light);
}

.arena_notice_actions {
    display: flex;
    flex-direction: column;
    align-items: center;
    margin-top: 20px;

    .ava_button {
        width: 100%;
    }

    .ava_button_secondary {
        margin-top: 10px;
    }
}

.menu-btn {
    font-size: 18px !important;
    box-shadow: none !important;
    text-transform: none !important;
    font-weight: bold !important;

    &:hover,
    &:focus-visible,
    &:active {
        background-color: rgba(0, 0, 0, 0.05) !important;
    }
}

@include main.night-mode {
    .menu-btn {
        &:hover,
        &:focus-visible,
        &:active {
            background-color: rgba(255, 255, 255, 0.07) !important;
        }
    }
}

:deep(.v-overlay__content .v-list) {
    background-color: var(--bg-light) !important;
    color: var(--primary-color) !important;
    border: 1px solid var(--bg-light);
}

:deep(.v-list-item:hover) {
    background-color: var(--bg) !important;
}

:deep(.v-list-item--density-default) {
    min-height: 25px !important;
}

:deep(.v-list-item-title) {
    color: var(--primary-color) !important;
    text-transform: none !important;
    font-weight: normal;
    font-size: 14px !important;
}
</style>
