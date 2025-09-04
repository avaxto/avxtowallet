<template>
    <modal ref="modal" :title="$t('modal.qr.title')">
        <div class="qr_body">
            <canvas ref="qr"></canvas>
            <p>{{ address }}</p>
            <CopyText :value="address" class="copyBut">{{ $t('modal.qr.copy') }}</CopyText>
        </div>
    </modal>
</template>
<script lang="ts">
import { defineComponent, ref, watch, nextTick, getCurrentInstance } from 'vue'
import { useI18n } from 'vue-i18n'

import Modal from './Modal.vue'
import CopyText from '../misc/CopyText.vue'
import QRCode from 'qrcode'
import { KeyPair as AVMKeyPair } from 'avalanche/dist/apis/avm'
import MnemonicWallet from '@/js/wallets/MnemonicWallet'
import { LedgerWallet } from '@/js/wallets/LedgerWallet'

export default defineComponent({
    name: 'QRModal',
    components: {
        Modal,
        CopyText,
    },
    props: {
        address: {
            type: String,
            default: '-'
        }
    },
    setup(props) {
        const { t } = useI18n()
        const instance = getCurrentInstance()
        
        const modal = ref<InstanceType<typeof Modal>>()
        const qr = ref<HTMLCanvasElement>()
        const colorDark = ref('#242729')
        const colorLight = ref('#FFF')

        const updateQR = () => {
            if (!props.address || !qr.value) return
            QRCode.toCanvas(
                qr.value,
                props.address,
                {
                    scale: 6,
                    color: {
                        light: colorLight.value,
                        dark: colorDark.value,
                    },
                },
                function (error) {
                    if (error) console.error(error)
                }
            )
        }

        watch(() => props.address, (val: string) => {
            if (val) {
                updateQR()
            }
        }, { immediate: true })

        watch(() => instance?.appContext.config.globalProperties.$root?.theme, (val: string) => {
            if (val === 'night') {
                colorDark.value = '#E5E5E5'
                colorLight.value = '#242729'
            } else {
                colorDark.value = '#242729'
                colorLight.value = '#FFF'
            }
            updateQR()
        }, { immediate: true })

        const open = () => {
            if (modal.value) {
                modal.value.open()
            }

            nextTick(() => {
                updateQR()
            })
        }

        return {
            modal,
            qr,
            colorDark,
            colorLight,
            open,
            updateQR
        }
    }
})
</script>
<style scoped lang="scss">
.qr_body {
    padding: 30px;
    text-align: center;
}

.qr_body p {
    word-break: break-all;
    text-align: center;
}
canvas {
    width: 220px;
    height: 220px;
}

.copyBut {
    /*width: 20px;*/
    /*height: 20px;*/
    margin: 15px auto;
    margin-bottom: 0;
    opacity: 0.6;

    &:hover {
        opacity: 1;
    }
    /*display: block;*/
    /*margin: 0px auto;*/
}
</style>
