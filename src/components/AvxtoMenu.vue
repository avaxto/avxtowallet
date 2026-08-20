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
                <v-list-item>
                    <v-list-item-title>
                        <a
                            href="https://lfj.gg/avalanche/trade/0xf56cecc07d97ac50630022cf84c19e612ae8c93d"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="wallet_link"
                        >
                            Buy AVXTO at LFJ
                        </a>
                    </v-list-item-title>
                </v-list-item>

                <v-list-item>
                    <v-list-item-title>
                        <!--
                        Not a plain link: ArenaTrade lists both Avalanche's and
                        Robinhood's AVXTO under the same symbol at two
                        different contract addresses, and buying on the wrong
                        one is a real-money mistake that a hover-only tooltip
                        is too easy to miss. Clicking opens the notice modal
                        below instead of navigating; the link only opens once
                        the user has actually seen it and pressed Proceed.
                    -->
                        <a
                            :href="arenaTradeUrl"
                            class="wallet_link"
                            title="In ArenaTrade make sure to switch to Avalanche mode to buy AVXTO. Robinhood CA is on a different address."
                            @click.prevent="openArenaTradeNotice"
                        >
                            Buy AVXTO at ArenaTrade
                        </a>
                    </v-list-item-title>
                </v-list-item>

                <v-list-item>
                    <v-list-item-title>
                        <a
                            href="https://dexscreener.com/avalanche/0x2bdebde7e1088e42aafef104b5f7457aca5ab86f"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="wallet_link"
                        >
                            More info @ DEXScreener
                        </a>
                    </v-list-item-title>
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
            arenaTradeUrl: ARENATRADE_URL,
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

.wallet_link {
    font-size: 14px !important;
    color: var(--primary-color) !important;
    text-decoration: none;
}

// Vuetify applies its own text color straight to the <a>/router-link
// rendered inside .v-list-item-title, so color:inherit from the title
// wrapper never actually reaches it — same fix NavbarMenu.vue and
// Sidebar.vue's nav links use: set the theme-aware color explicitly, right
// on the link itself.
:deep(.v-list-item-title a),
:deep(.v-list-item-title .router-link-active) {
    color: var(--primary-color) !important;
    text-decoration: none;
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
