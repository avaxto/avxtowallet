<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<template>
    <modal ref="modalRef" title="About" class="modal_main">
        <div class="about_body">
            <img src="@/assets/avaxtowallet_logo.png" class="about_logo" />
            <p class="version">Version {{ version }}</p>
            <p class="desc">
                A non-custodial wallet for the Avalanche network — manage X/P/C-chain
                assets, delegate, swap, and interact with the AVXTO ecosystem.
            </p>
            <p class="copyright">© 2026 @REKTBuildr</p>
            <p class="license">License: BSD 3-Clause License</p>
            <div class="about_links">
                <a
                    href="https://github.com/avaxto/avxtowallet"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="wallet_link"
                >
                    View source on GitHub
                </a>
                <a
                    href="https://x.com/avaxto"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="wallet_link"
                >
                    AVAX.to on X (@avaxto)
                </a>
                <a
                    href="https://x.com/rektbuildr"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="wallet_link"
                >
                    Author @REKTBuildr on X
                </a>
            </div>
            <v-btn class="ava_button button_primary close_btn" @click="close">Close</v-btn>
        </div>
    </modal>
</template>
<script lang="ts">
import 'reflect-metadata'
import { defineComponent, ref } from 'vue'
import Modal from '@/components/modals/Modal.vue'
import { AVAX_TOOLBOX_VERSION } from '@/avxto/AVXTOConf'

export default defineComponent({
    name: 'AboutModal',
    components: {
        Modal,
    },
    setup() {
        const modalRef = ref<InstanceType<typeof Modal>>()

        const open = (): void => {
            modalRef.value?.open()
        }

        const close = (): void => {
            modalRef.value?.close()
        }

        return {
            modalRef,
            version: AVAX_TOOLBOX_VERSION,
            open,
            close,
        }
    },
})
</script>
<style scoped lang="scss">
.about_body {
    width: 360px;
    max-width: 100%;
    padding: 30px;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
}

.about_logo {
    width: 220px;
    max-width: 100%;
    height: auto;
    object-fit: contain;
    margin-bottom: 14px;
}

.version {
    font-size: 12px;
    color: var(--primary-color-light);
    margin: 0 0 16px;
}

.desc {
    font-size: 13px;
    line-height: 1.5;
    color: var(--primary-color);
    margin-bottom: 14px;
}

.copyright {
    font-size: 11.5px;
    color: var(--primary-color-light);
    margin-bottom: 2px;
}

.license {
    font-size: 11.5px;
    color: var(--primary-color-light);
    margin-bottom: 14px;
}

.about_links {
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.wallet_link {
    font-size: 13px;
    color: var(--secondary-color);
    text-decoration: none;

    &:hover {
        text-decoration: underline;
    }
}

.close_btn {
    margin-top: 20px;
    width: 100%;
}
</style>
