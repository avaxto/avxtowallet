<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<!--
  "Open this page in your wallet app" — shown on a phone when no wallet is
  injected. A phone's normal browser can't reach wallet apps the way a
  desktop browser reaches extensions; see helpers/mobileWallets.ts.
-->
<template>
    <div class="mobile_wallet_help">
        <p class="help_title">
            <fa icon="mobile-screen-button"></fa>
            Using a wallet app on your phone?
        </p>
        <p class="help_text">
            Phone browsers like Chrome and Safari can't connect to wallet apps directly. Open this
            page inside your wallet app's own browser, where it can connect:
        </p>
        <div class="app_links">
            <a v-for="l in links" :key="l.name" :href="l.href" class="app_link" rel="noopener noreferrer">
                Open in {{ l.name }}
            </a>
        </div>
        <p class="help_text">
            Rabby, Core or another wallet: open its built-in browser and go to this address.
        </p>
        <div class="url_row">
            <span class="mono page_url">{{ pageUrl }}</span>
            <CopyText :value="pageUrl" class="copy_url">Copy</CopyText>
        </div>
        <p class="help_text muted">You can also log in below with a recovery phrase or keystore file.</p>
    </div>
</template>

<script lang="ts">
import { defineComponent, computed } from 'vue'
import CopyText from '@/components/misc/CopyText.vue'
import { walletAppLinks } from '@/helpers/mobileWallets'

export default defineComponent({
    name: 'MobileWalletHelp',
    components: { CopyText },
    setup() {
        const pageUrl = computed(() => window.location.href)
        const links = computed(() => walletAppLinks(pageUrl.value))
        return { pageUrl, links }
    },
})
</script>

<style scoped lang="scss">
.mobile_wallet_help {
    width: 100%;
    max-width: 440px;
    box-sizing: border-box;
    text-align: left;
    background: var(--bg);
    border: 1px solid var(--secondary-color);
    border-radius: 12px;
    padding: 16px 18px;
    margin: 0 auto 20px;
    color: var(--primary-color);
}

.help_title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 700;
    font-size: 15px;
    margin-bottom: 6px !important;
}

.help_text {
    font-size: 13px;
    line-height: 1.5;
    color: var(--primary-color-light);
    margin: 8px 0 !important;

    &.muted {
        font-size: 12px;
    }
}

.app_links {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin: 10px 0;
}

.app_link {
    display: block;
    text-align: center;
    padding: 10px 8px;
    border-radius: 8px;
    background: var(--bg-light);
    color: var(--primary-color) !important;
    font-size: 13px;
    font-weight: 600;
    text-decoration: none;
}

.url_row {
    display: flex;
    align-items: center;
    gap: 10px;
    background: var(--bg-light);
    border-radius: 8px;
    padding: 8px 10px;
}

.page_url {
    flex: 1;
    min-width: 0;
    font-size: 12px;
    word-break: break-all;
}

.copy_url {
    flex-shrink: 0;
    font-size: 12px;
}

.mono {
    font-family: monospace;
}
</style>
