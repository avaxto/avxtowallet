<template>
    <transition name="fade">
        <div v-if="thrModalStore.isVisible" class="thr_modal_overlay">
            <div class="thr_modal_body">
                <div class="thr_modal_content">                    
                    <p class="thr_message">
                        The AVXTO balance on this account is below the required minimum threshold to use this wallet.<br /><br />
                        Please acquire more <strong>AVXTO</strong> tokens to continue.
                        <br /><br />
                        You can buy AVXTO at <a href="https://lfj.gg/avalanche/trade/0xf56cecc07d97ac50630022cf84c19e612ae8c93d" target="_blank" rel="noopener noreferrer">LFJ</a>
                        or <a href="https://arenatrade.ai/token/0xf56cecc07d97ac50630022cf84c19e612ae8c93d" target="_blank" rel="noopener noreferrer">ArenaTrade</a>. Or any other DEX that supports AVXTO.
                        <br /><br />    
                        Always check the contract address before making a purchase : <code>0xf56CeCc07d97Ac50630022CF84C19e612ae8C93D</code>
                    </p>
                </div>
            </div>
        </div>
    </transition>
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import { useThrModalStore } from '@/stores/thrModal'

export default defineComponent({
    name: 'BaseAssetThrModal',
    setup() {
        const thrModalStore = useThrModalStore()
        return { thrModalStore }
    },
})
</script>

<style scoped lang="scss">
.thr_modal_overlay {
    position: fixed;
    inset: 0;
    z-index: 9999;
    background-color: rgba(0, 0, 0, 0.75);
    display: flex;
    align-items: center;
    justify-content: center;
}

.thr_modal_body {
    background-color: var(--bg-light);
    border-radius: 8px;
    padding: 40px 48px;
    max-width: 520px;
    width: 90%;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

.thr_modal_content {
    display: flex;
    flex-direction: column;
    align-items: center;
}

.thr_message {
    text-align: center;
    color: var(--primary-color);
    font-size: 15px;
    line-height: 1.7;
    margin: 0;

    a {
        color: var(--secondary-color);
        text-decoration: underline;
    }
}
</style>
