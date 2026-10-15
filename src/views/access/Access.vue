<template>
    <div class="access_view">
        <v-container class="px-3 py-0">
            <v-row justify="center" class="my-0">
                <v-col md="12" lg="10" class="py-0">
                    
                    <router-view v-slot="{ Component }">
                        <transition>
                            <component :is="Component" />
                        </transition>
                    </router-view>
                    
                </v-col>
            </v-row>
        </v-container>
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
