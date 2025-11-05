<template>
    <div class="network_warning" :visible="isVisible">
        <p>{{ $t('network.not_mainnet') }}</p>
    </div>
</template>
<script lang="ts">
import { AvaNetwork } from '@/js/AvaNetwork'
import 'reflect-metadata'
import { defineComponent, computed } from 'vue'
import { useNetworkStore } from '@/stores'

export default defineComponent({
    name: 'TestNetBanner',
    setup() {
        const networkStore = useNetworkStore()
        
        const isVisible = computed(() => {
            // For now, using placeholder logic - will be implemented when network store is completed
            return null
        })

        return {
            isVisible
        }
    }
})
</script>
<style scoped lang="scss">
$h: 24px;
.network_warning {
    background-color: var(--secondary-color);
    color: #fff;
    font-size: 13px;
    text-align: center;
    position: fixed;
    bottom: -$h;
    width: 100%;
    height: $h;
    line-height: $h;
    z-index: 2;
    transition-duration: 0.4s;

    &[visible] {
        bottom: 0px;
    }
}
</style>
