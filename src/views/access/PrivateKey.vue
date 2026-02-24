<template>
    <div class="access_card">
        <div class="content">
            <h1>Private Key</h1>
            <form @submit.prevent="access">
                <v-text-field
                    class="pass"
                    label="Private Key"
                    dense
                    solo
                    flat
                    type="password"
                    v-model="privatekey"
                    hide-details
                ></v-text-field>
                <p class="err">{{ error }}</p>
                <v-btn
                    class="ava_button button_primary"
                    @click="access"
                    :loading="isLoading"
                    :disabled="!canSubmit"
                    depressed
                >
                    Access Wallet
                </v-btn>
            </form>
            <router-link to="/access" class="link">Cancel</router-link>
        </div>
    </div>
</template>
<script lang="ts">
import { defineComponent, ref, computed } from 'vue'
import { useMainStore } from '@/stores'
import { useRouter } from 'vue-router'
import { ImportKeyfileInput } from '@/types'
import { SingletonWallet } from '@/js/wallets/SingletonWallet'
import { privateToAddress } from 'ethereumjs-util'
import { bintools } from '@/AVA'
import { Buffer } from '@/avalanche'
import { strip0x } from '@/avalanche-wallet-sdk'

export default defineComponent({
    name: 'PrivateKey',
    setup() {
        const mainStore = useMainStore()
        const router = useRouter()
        
        const privatekey = ref<string>('')
        const isLoading = ref<boolean>(false)
        const error = ref<string>('')

        const canSubmit = computed((): boolean => {
            if (!privatekey.value) {
                return false
            }
            return true
        })

        const access = async () => {
            if (!canSubmit.value || isLoading.value) return
            error.value = ''
            isLoading.value = true
            let key = strip0x(privatekey.value)

            try {
                let res = await mainStore.accessWalletSingleton(key)
                onsuccess()
            } catch (e) {
                onerror('Invalid Private Key.')
            }
        }

        const onsuccess = () => {
            isLoading.value = false
            privatekey.value = ''
        }

        const onerror = (e: any) => {
            error.value = e
            privatekey.value = ''
            isLoading.value = false
        }

        return {
            privatekey,
            isLoading,
            error,
            canSubmit,
            access,
            onsuccess,
            onerror
        }
    }
})
</script>
<style scoped lang="scss">
@use '../../main';
.pass {
    background-color: var(--bg) !important;
}
.ava_button {
    width: 100%;
    margin-bottom: 22px;
}
.access_card {
    /*max-width: 80vw;*/
    background-color: var(--bg-light);
    padding: main.$container-padding;
    width: 100%;
    /*max-width: 240px;*/
    /*max-width: 1000px;*/
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
}
h1 {
    font-size: main.$m-size;
    font-weight: 400;
    margin-bottom: 30px;
}
.file_in {
    margin: 30px auto 10px;
    font-size: 13px;
    border: none !important;
    background-color: var(--bg) !important;
    /*min-width: 200px*/
}
a {
    color: main.$primary-color-light !important;
    text-decoration: underline !important;
    margin: 10px 0 20px;
}
.link {
    color: var(--secondary-color);
}
.remember {
    margin: 12px 0;
}
.err {
    font-size: 13px;
    color: var(--error);
    margin: 14px 0px !important;
}
@media only screen and (max-width: main.$mobile_width) {
    h1 {
        font-size: main.$m-size-mobile;
    }
    .but_primary {
        width: 100%;
    }
}
</style>
