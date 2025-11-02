<template>
    <div>
        <h2>{{ $t('advanced.verify.title') }}</h2>
        <p style="margin-bottom: 14px !important">
            {{ $t('advanced.verify.desc') }}
        </p>
        <div>
            <label>{{ $t('advanced.verify.label1') }}</label>
            <textarea v-model="message"></textarea>
        </div>
        <div>
            <label>{{ $t('advanced.verify.label2') }}</label>
            <textarea v-model="signature"></textarea>
        </div>
        <p class="err">{{ error }}</p>
        <v-btn
            class="button_secondary"
            block
            small
            depressed
            @click="verify"
            :disabled="!canSubmit"
        >
            {{ $t('advanced.verify.submit') }}
        </v-btn>
        <div v-if="addressX" class="result">
            <label>{{ $t('advanced.verify.label3') }}</label>
            <p class="address">{{ addressX }}</p>
            <p class="address">{{ addressP }}</p>
        </div>
    </div>
</template>
<script lang="ts">
import { defineComponent, ref, computed } from 'vue'
import { KeyPair } from '@/avalanche/apis/avm'
import { ava, bintools } from '@/AVA'
import createHash from 'create-hash'
import { getPreferredHRP } from '@/avalanche/utils'
import { avm } from '@/AVA'
import { Buffer } from '@/avalanche'
import { digestMessage } from '@/helpers/helper'

export default defineComponent({
    name: 'VerifyMessage',
    setup() {
        const message = ref('')
        const addressX = ref('')
        const addressP = ref('')
        const signature = ref('')
        const error = ref('')

        const canSubmit = computed(() => {
            if (!message.value || !signature.value) return false
            return true
        })

        const submit = () => {
            addressX.value = ''
            addressP.value = ''
            error.value = ''
            try {
                verify()
            } catch (e) {
                error.value = e
            }
        }

        const verify = () => {
            let digest = digestMessage(message.value)
            let digestBuff = Buffer.from(digest.toString('hex'), 'hex')

            let networkId = ava.getNetworkID()

            let hrp = getPreferredHRP(networkId)
            let keypair = new KeyPair(hrp, 'X')

            let signedBuff = bintools.cb58Decode(signature.value)

            let pubKey = keypair.recover(digestBuff, signedBuff)
            const addressBuff = KeyPair.addressFromPublicKey(pubKey)
            addressX.value = bintools.addressToString(hrp, 'X', addressBuff)
            addressP.value = bintools.addressToString(hrp, 'P', addressBuff)
        }

        const clear = () => {
            message.value = ''
            signature.value = ''
            addressX.value = ''
            addressP.value = ''
            error.value = ''
        }

        return {
            message,
            addressX,
            addressP,
            signature,
            error,
            canSubmit,
            submit,
            verify,
            clear
        }
    },
    deactivated() {
        this.clear()
    }
})
</script>
<style lang="scss" scoped>
textarea,
input,
.address {
    padding: 6px 12px;
    width: 100%;
    background-color: rgba(0, 0, 0, 0.1);
    font-size: 13px;
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
    padding: 6px 12px;
    height: 80px;
}

.result {
    margin-top: 6px;
}

.address {
    margin-bottom: 1px !important;
    word-break: break-all;
}
</style>
