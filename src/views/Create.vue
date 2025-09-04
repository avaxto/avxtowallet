<template>
    <div class="access_view">
        <create-wallet></create-wallet>
    </div>
</template>
<script lang="ts">
import 'reflect-metadata'
import { defineComponent } from 'vue'
import { useHead } from '@unhead/vue'

import CreateWallet from '@/components/CreateWalletWorkflow/CreateWallet.vue'

export default defineComponent({
    name: 'Create',
    components: {
        CreateWallet,
    },
    setup() {
        const description = "Here at Avalanche, we've made storing digital assets easy. Create an Avalanche wallet today is see what the buzz is all about!"
        
        useHead({
            title: 'Create',
            meta: [
                {
                    name: 'description',
                    content: description,
                },
                {
                    property: 'og:description',
                    content: description,
                },
                {
                    property: 'og:title',
                    content: 'Create | Avalanche Wallet',
                },
            ],
        })
    }
})
</script>
<style scoped lang="scss">
@use '../main';

.access_view {
    /*display: grid;*/
    /*grid-template-columns: 1fr 1fr;*/
    display: flex;
    justify-content: center;
    align-items: center;
}

.card {
    text-align: center;
}

a {
    color: #1d82bb !important;
}
</style>
