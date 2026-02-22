<template>
    <div class="access_card">
        <div class="content">
            <h1>{{ $t('access.injected.title') }}</h1>
            <p class="desc">{{ $t('access.injected.desc') }}</p>
            <p class="err" v-if="error">{{ error }}</p>
            <v-btn
                class="ava_button button_primary"
                @click="connect"
                :loading="isLoading"
                depressed
            >
                {{ $t('access.injected.submit') }}
            </v-btn>
            <router-link to="/access" class="link">{{ $t('access.injected.cancel') }}</router-link>
        </div>
    </div>
</template>
<script lang="ts">
import { defineComponent, ref } from 'vue'
import { useMainStore } from '@/stores'

export default defineComponent({
    name: 'Injected',
    setup() {
        const mainStore = useMainStore()

        const isLoading = ref<boolean>(false)
        const error = ref<string>('')

        const connect = async () => {
            if (isLoading.value) return
            error.value = ''
            isLoading.value = true

            try {
                await mainStore.accessWalletInjected()
            } catch (e: any) {
                error.value = e.message || 'Failed to connect wallet.'
                isLoading.value = false
            }
        }

        return {
            isLoading,
            error,
            connect,
        }
    },
})
</script>
<style scoped lang="scss">
@use '../../main';

.ava_button {
    width: 100%;
    margin-bottom: 22px;
}
.access_card {
    background-color: var(--bg-light);
    padding: main.$container-padding;
    width: 100%;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    border-radius: 6px;
}
.content {
    width: 340px;
    max-width: 100%;
    margin: 0px auto;
    text-align: center;
}
h1 {
    font-size: main.$m-size;
    font-weight: 400;
    margin-bottom: 14px;
}
.desc {
    font-size: 14px;
    color: var(--primary-color-light);
    margin-bottom: 30px;
}
a {
    color: main.$primary-color-light !important;
    text-decoration: underline !important;
    margin: 10px 0 20px;
}
.link {
    color: var(--secondary-color);
}
.err {
    font-size: 13px;
    color: var(--error);
    margin: 14px 0px !important;
}
</style>
