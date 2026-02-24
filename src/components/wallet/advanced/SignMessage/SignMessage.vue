<template>
    <div>
        <h2>{{ $t('advanced.sign.title') }}</h2>
        <p style="margin-bottom: 14px !important">
            {{ $t('advanced.sign.desc') }}
        </p>
        <div v-if="isHD">
            <label>{{ $t('advanced.sign.label1') }}</label>
            <SearchAddress :wallet="wallet" v-model="sourceAddress"></SearchAddress>
        </div>
        <div>
            <label>{{ $t('advanced.sign.label2') }}</label>
            <p class="warn">{{ $t('advanced.sign.warn') }}</p>
            <textarea v-model="message"></textarea>
        </div>
        <p class="err">{{ error }}</p>
        <v-btn class="button_secondary" block small depressed @click="sign" :disabled="!canSubmit">
            {{ $t('advanced.sign.submit') }}
        </v-btn>

        <div v-if="signed" class="result">
            <label>{{ $t('advanced.sign.label3') }}</label>
            <p class="signed">{{ signed }}</p>
        </div>
    </div>
</template>
<script lang="ts">
import { defineComponent, ref, computed, onDeactivated } from 'vue'
import { useMainStore } from '@/stores'
import { WalletType } from '@/js/wallets/types'
import SearchAddress from '@/components/wallet/advanced/SignMessage/SearchAddress.vue'
import { SingletonWallet } from '@/js/wallets/SingletonWallet'

export default defineComponent({
    name: 'SignMessage',
    components: { 
        SearchAddress 
    },
    setup() {
        const mainStore = useMainStore()
        const sourceAddress = ref(null)
        const message = ref('')
        const signed = ref('')
        const error = ref('')

        const wallet = computed((): WalletType => {
            return mainStore.activeWallet
        })

        const isHD = computed(() => {
            return wallet.value.type !== 'singleton'
        })

        const canSubmit = computed((): boolean => {
            if (!sourceAddress.value && isHD.value) return false
            if (!message.value) return false

            return true
        })

        const sign = async () => {
            error.value = ''
            try {
                // Convert the message to a hashed buffer
                // let hashMsg = this.msgToHash(this.message);
                if (wallet.value.type === 'singleton') {
                    signed.value = await (wallet.value as SingletonWallet).signMessage(message.value)
                } else {
                    signed.value = await wallet.value.signMessage(message.value, sourceAddress.value!)
                }
            } catch (e) {
                error.value = e as string
            }
        }

        const clear = () => {
            message.value = ''
            signed.value = ''
            error.value = ''
        }

        onDeactivated(() => {
            clear()
        })

        return {
            sourceAddress,
            message,
            signed,
            error,
            wallet,
            isHD,
            canSubmit,
            sign,
            clear
        }
    }
})
</script>
<style scoped lang="scss">
select,
textarea,
.signed {
    padding: 6px 12px;
    background-color: rgba(0, 0, 0, 0.1);
}
select {
    outline: none;
    width: 100%;
    color: var(--primary-color);
    cursor: pointer;
    font-size: 13px;

    &:hover {
        color: var(--primary-color);
    }
}

option {
    background-color: var(--bg-wallet);
}

label {
    display: block;
    text-align: left;
    color: var(--primary-color-light);
    font-size: 12px;
    margin-bottom: 20px;
    margin-top: 6px;
}

textarea {
    width: 100%;
    resize: none;
    font-size: 13px;
    padding: 6px 12px;
    height: 80px;
}

.signed {
    word-break: break-all;
    font-size: 12px;
}

.warn {
    font-size: 12px;
    color: var(--secondary-color);
}

.result {
    margin-top: 6px;
}
</style>
