<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<!--
  The "Moats" dropdown — the AVXTO moat's dashboard, the burn/stake/lock
  pages, and its moats.app page. Split out of AvxtoMenu.vue, which is left
  with where to get AVXTO.

  Rendered by NavbarMenu.vue and the pre-login Home page, like AvxtoMenu. The
  in-wallet pages sit behind the router's auth guard, so they are listed only
  once a wallet is connected; logged out, only the external moats.app link
  shows.
-->
<template>
    <v-menu offset-y>
        <template v-slot:activator="{ props }">
            <v-btn text v-bind="props" class="menu-btn">
                <fa icon="chess-rook" class="moats_icon"></fa>
                Moats
            </v-btn>
        </template>
        <v-list>
            <template v-if="isAuth">
                <v-list-item :to="`/wallet/moats/dashboard/${avxtoMoat}`">
                    <v-list-item-title>AVXTO Moat Dashboard</v-list-item-title>
                </v-list-item>
                <v-list-item to="/wallet/moats/stake">
                    <v-list-item-title>Stake AVXTO</v-list-item-title>
                </v-list-item>
                <v-list-item to="/wallet/moats/lock">
                    <v-list-item-title>Lock AVXTO</v-list-item-title>
                </v-list-item>
                <v-list-item to="/wallet/moats/burn">
                    <v-list-item-title>Burn AVXTO</v-list-item-title>
                </v-list-item>
            </template>
            <v-list-item
                :href="`https://moats.app/moat/${avxtoMoat}`"
                target="_blank"
                rel="noopener noreferrer"
            >
                <v-list-item-title>AVXTO Moat on moats.app</v-list-item-title>
            </v-list-item>
        </v-list>
    </v-menu>
</template>
<script lang="ts">
import { defineComponent, computed } from 'vue'
import { useActivePlatformStore } from '@/platforms'
import { MOATS_CONTRACT_ADDRESS } from '@/js/Moats'

export default defineComponent({
    name: 'MoatsMenu',
    setup() {
        const platformStore = useActivePlatformStore()
        // Same platform-generic check AvxtoMenu.vue and NavbarMenu.vue use.
        const isAuth = computed(() => platformStore.activeWallet !== null)

        return { isAuth, avxtoMoat: MOATS_CONTRACT_ADDRESS }
    },
})
</script>
<style scoped lang="scss">
@use '../main';

// Links sit on the whole row (see the note atop NavbarMenu.vue), which renders
// as <a class="v-list-item">: undo Bootstrap's link colour/underline and
// Vuetify's current-route tint, as NavbarMenu does.
:deep(a.v-list-item) {
    color: var(--primary-color) !important;
    text-decoration: none !important;
}

:deep(.v-list-item--active > .v-list-item__overlay) {
    opacity: 0 !important;
}

.moats_icon {
    margin-right: 8px;
    font-size: 15px;
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
