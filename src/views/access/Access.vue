<template>
    <div class="access_view">
        <b-container>
            <b-row align-h="center">
                <b-col md="12" lg="10">
                    <router-view v-slot="{ Component }">
                        <transition>
                            <component :is="Component" />
                        </transition>
                    </router-view>
                    
                </b-col>
            </b-row>
        </b-container>
    </div>
</template>
<script lang="ts">
import { defineComponent } from 'vue'
import { useHead } from '@unhead/vue'

export default defineComponent({
    name: 'Access',
    setup() {
        const description = 'Access your stored crypto assets in a simple fashion, yet highly secure, and non-custodial fashion. Your Avalanche wallet is a few clicks away!'
        
        useHead({
            title: 'Access Stored Crypto Assets',
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
                    content: 'Access Stored Crypto Assets | Avalanche Wallet',
                },
            ],
        })
    }
})
</script>
<style scoped lang="scss">
@use "../../main";

.access_view {
    display: flex;
    justify-content: center;
    align-items: center;
}

.access_card {
    text-align: center;
}
</style>
