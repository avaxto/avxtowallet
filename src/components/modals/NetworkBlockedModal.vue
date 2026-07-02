<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<template>
    <modal ref="modalRef" title="Network Requests Blocked" :can_close="false" :icy="true">
        <div class="blocked_body">
            <p class="warn_icon">⚠️</p>
            <p>
                The server responded with <strong>HTTP 429 (rate limited)</strong>. To avoid
                making the problem worse, all further network requests from this tab have been
                stopped.
            </p>
            <p>
                <strong>Please close this browser tab and come back later.</strong> Reloading or
                continuing to use this tab will not help — the server needs time to recover.
            </p>
        </div>
    </modal>
</template>
<script lang="ts">
import { defineComponent, ref, onMounted, onBeforeUnmount } from 'vue'
import Modal from '@/components/modals/Modal.vue'
import { globalRateLimiter } from '@/providers/rate_limiter'

export default defineComponent({
    name: 'NetworkBlockedModal',
    components: { Modal },
    setup() {
        const modalRef = ref<InstanceType<typeof Modal>>()

        const onBlocked = () => {
            modalRef.value?.open()
        }

        onMounted(() => {
            // Cover the case where the block already happened before this
            // component mounted (e.g. a 429 hit during initial app load).
            if (globalRateLimiter.blocked) {
                onBlocked()
            }
            window.addEventListener('avxto:network-blocked', onBlocked)
        })

        onBeforeUnmount(() => {
            window.removeEventListener('avxto:network-blocked', onBlocked)
        })

        return { modalRef }
    },
})
</script>
<style scoped lang="scss">
.blocked_body {
    padding: 30px;
    max-width: 420px;
    text-align: center;
    line-height: 1.6;

    .warn_icon {
        font-size: 32px;
        margin-bottom: 12px;
    }
}
</style>
