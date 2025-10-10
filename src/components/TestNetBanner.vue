<template>
    <div class="network_warning" :visible="isVisible">
        <p>{{ $t('network.not_mainnet') }}</p>
    </div>
</template>
<script lang="ts">
import { AvaNetwork } from '@/js/AvaNetwork'
import 'reflect-metadata'
import { defineComponent, computed } from 'vue'
import { useStore } from 'vuex'

export default defineComponent({
    name: 'TestNetBanner',
    setup() {
        const store = useStore()
        
        const isVisible = computed(() => {
            let network = store.state.Network.selectedNetwork
            if (!network) return null
            let netId = parseInt(network.networkId)

            if (netId == 1) return null
            return true
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
