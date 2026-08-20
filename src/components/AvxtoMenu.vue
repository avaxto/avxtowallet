<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<!--
  The "AVXTO" dropdown — activity link plus where to buy it.

  Extracted out of NavbarMenu.vue so the same menu can appear on the
  pre-login Home page, not only inside the logged-in wallet layout
  (NavbarMenu.vue is otherwise built around post-login state — isAuth,
  isAvalanche, save/logout modals — none of which this menu needs). Both
  places render this component now, so the two link lists cannot drift.

  "AVXTO Activity" points at a `/wallet` route, which is guarded and bounces
  an unauthenticated visitor back to '/' — the same thing clicking any other
  /wallet link while logged out already does elsewhere in the app, so it is
  left in rather than special-cased out for this one page.
-->
<template>
    <v-menu offset-y>
        <template v-slot:activator="{ props }">
            <v-btn text v-bind="props" class="menu-btn">AVXTO Required For Access</v-btn>
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
                    <a
                        href="https://arenatrade.ai/token/0xf56cecc07d97ac50630022cf84c19e612ae8c93d"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="wallet_link"
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
                        DEXScreener
                    </a>
                </v-list-item-title>
            </v-list-item>
        </v-list>
    </v-menu>
</template>

<script lang="ts">
import { defineComponent } from 'vue'

export default defineComponent({
    name: 'AvxtoMenu',
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

.menu-btn {
    font-size: 18px !important;
    box-shadow: none !important;
    text-transform: none !important;

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
