<template>
    <modal ref="modal" :title="$t('modal.print.title')" class="print_modal">
        <div class="qr_body" ref="qr_body">
            <img
                ref="bg"
                src="@/assets/paper_wallet/bg.png"
                :style="{
                    display: 'none',
                    height: `${height}px`,
                    width: `100%`,
                    // width: '100%',
                    // paddingTop: `${100 / aspectRatio}%`,
                }"
            />
            <canvas
                class="pdf_preview"
                ref="pdf"
                :style="{
                    width: `100%`,
                    height: `${height}px`,
                    // width: '100%',
                    // paddingTop: `${100 / aspectRatio}%`,
                }"
            ></canvas>
            <v-btn depressed block @click="print">{{ $t('modal.print.submit') }}</v-btn>
        </div>
    </modal>
</template>
<script lang="ts">
import { defineComponent, ref, computed, watch, onMounted } from 'vue'
import { useMainStore } from '@/stores'

import Modal from '@/components/modals/Modal.vue'
import MnemonicWallet from '@/js/wallets/MnemonicWallet'
import QRCode from 'qrcode'
import printjs from 'print-js'

const PDF_W = 8.5
const PDF_H = 11
const PDF_ASPECT_RATIO = PDF_W / PDF_H

// Contents of the pdf are set according to this value
const designWidth = 525 - 60

export default defineComponent({
    name: 'PaperWallet',
    components: {
        Modal,
    },
    props: {
        wallet: {
            type: Object as () => MnemonicWallet,
            required: true
        }
    },
    setup(props) {
        const mainStore = useMainStore()
        const modal = ref<InstanceType<typeof Modal> | null>(null)
        const pdf = ref<HTMLCanvasElement | null>(null)
        const bg = ref<HTMLImageElement | null>(null)
        
        const qrImg = ref<HTMLImageElement | null>(null)
        const mnemonicImg = ref<HTMLImageElement | null>(null)
        
        // Height and Width of the img and canvas
        const width = ref(100)
        const height = ref(100)

        const open = () => {
            modal.value?.open()

            setTimeout(() => {
                setSizes()
            }, 200)

            setTimeout(() => {
                initBg()
            }, 500)
        }

        const address = computed(() => {
            try {
                let wallet: MnemonicWallet = mainStore.activeWallet
                if (!wallet) return '-'

                let key = wallet.externalHelper.getKeyForIndex(0)
                if (!key) {
                    return '-'
                }
                return key.getAddressString()
            } catch (e) {
                return '-'
            }
        })

        const aspectRatio = computed((): number => {
            return PDF_W / PDF_H
        })

        const designPxToReal = (px: number) => {
            return (width.value / designWidth) * px
        }

        const initBg = () => {
            let canv = pdf.value
            if (!canv || !bg.value) return
            
            let cont = canv.getContext('2d') as CanvasRenderingContext2D
            let img = bg.value

            let w = canv.clientWidth
            let h = canv.clientHeight

            const sizeFactor = 3

            canv.width = w * sizeFactor
            canv.height = h * sizeFactor

            cont.scale(sizeFactor, sizeFactor)
            cont.drawImage(img, 0, 0, w, h)

            writeInfo()
        }

        const writeInfo = () => {
            let canv = pdf.value
            if (!canv) return
            
            let cont = canv.getContext('2d') as CanvasRenderingContext2D

            // Top Address
            const wrapChar = 25
            let addr = address.value
            let addr1 = addr.substr(0, wrapChar)
            let addr2 = addr.substr(wrapChar)

            cont.font = `${designPxToReal(8)}px Helvetica`
            cont.fillText(
                addr1,
                designPxToReal(352),
                designPxToReal(140),
                designPxToReal(120)
            )
            cont.fillText(
                addr2,
                designPxToReal(352),
                designPxToReal(150),
                designPxToReal(120)
            )
            if (qrImg.value) {
                cont.drawImage(
                    qrImg.value,
                    designPxToReal(352),
                    designPxToReal(10),
                    designPxToReal(100),
                    designPxToReal(100)
                )
            }

            // Bottom Address
            cont.font = `${designPxToReal(10)}px Helvetica`
            cont.fillText(addr, designPxToReal(40), designPxToReal(380))
            if (qrImg.value) {
                cont.drawImage(
                    qrImg.value,
                    designPxToReal(352),
                    designPxToReal(335),
                    designPxToReal(90),
                    designPxToReal(90)
                )
            }

            // Mnemonic
            let mnemonicWords: string[] = props.wallet.getMnemonic().split(' ')
            let row1 = mnemonicWords.slice(0, 8).join(' ')
            let row2 = mnemonicWords.slice(8, 16).join(' ')
            let row3 = mnemonicWords.slice(16).join(' ')
            cont.fillText(row1, designPxToReal(40), designPxToReal(490))
            cont.fillText(row2, designPxToReal(40), designPxToReal(505))
            cont.fillText(row3, designPxToReal(40), designPxToReal(520))
            if (mnemonicImg.value) {
                cont.drawImage(
                    mnemonicImg.value,
                    designPxToReal(352),
                    designPxToReal(445),
                    designPxToReal(90),
                    designPxToReal(90)
                )
            }
        }

        const buildQr = () => {
            QRCode.toDataURL(
                address.value,
                {
                    width: designPxToReal(100),
                },
                function (err, url) {
                    var img = new Image()
                    img.src = url
                    qrImg.value = img
                }
            )

            QRCode.toDataURL(
                props.wallet.getMnemonic(),
                {
                    width: designPxToReal(90),
                },
                function (err, url) {
                    var img = new Image()
                    img.src = url
                    mnemonicImg.value = img
                }
            )
        }

        const setSizes = () => {
            // Set height and width
            if (!pdf.value) return
            
            let contW = pdf.value.clientWidth

            width.value = contW
            height.value = contW / aspectRatio.value
        }

        const print = () => {
            let canv = pdf.value
            if (!canv) return
            
            printjs({
                printable: canv.toDataURL(),
                type: 'image',
                imageStyle: 'width:100%; margin: 5px;',
                maxWidth: 2800,
                documentTitle: '',
            })
        }

        watch(address, buildQr)
        watch(() => props.wallet.getMnemonic(), buildQr)

        onMounted(() => {
            buildQr()
        })

        return {
            modal,
            pdf,
            bg,
            qrImg,
            mnemonicImg,
            width,
            height,
            open,
            address,
            aspectRatio,
            initBg,
            writeInfo,
            buildQr,
            setSizes,
            designPxToReal,
            print
        }
    }
})
</script>
<style scoped>
.qr_body {
    width: 525px;
    max-width: 100%;
    padding: 30px;
    margin: 0px auto;
}

.qr_body p {
    word-break: break-all;
}

.pdf_preview {
    /*width: 420px;*/
    /*max-width: 100%;*/
    /*height: 320px;*/
    border: 1px solid #ddd;
}
</style>
