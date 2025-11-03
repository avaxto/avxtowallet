<template>
    <div class="qr_reader">
        <div class="buts" :disabled="disabled">
            <div class="clickStart" @click="start"></div>
            <slot class="qr_slot"></slot>
        </div>
        <div class="qr_popup" v-show="isActive">
            <div class="progress">
                <font-awesome-icon class="loading" :icon="fa_spinner"></font-awesome-icon>
                <p>Waiting for a QR Code</p>
            </div>
            <button @click="stop"><font-awesome-icon :icon="fa_times"></font-awesome-icon></button>
            <video ref="preview"></video>
        </div>
    </div>
</template>
<script lang="ts">
import { defineComponent, ref, onMounted } from 'vue'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { faSpinner, faTimes } from '@fortawesome/free-solid-svg-icons'
import { BrowserQRCodeReader } from '@zxing/library'

const QrReader = defineComponent({
    name: 'QrReader',
    components: {
        FontAwesomeIcon
    },
    props: {
        disabled: {
            type: Boolean,
            default: false
        }
    },
    emits: ['change'],
    setup(props, { emit }) {
        const scanner = ref<BrowserQRCodeReader | null>(null)
        const camera = ref<MediaDeviceInfo | null>(null)
        const isActive = ref(false)
        const preview = ref<HTMLVideoElement>()
        const fa_spinner = faSpinner
        const fa_times = faTimes

        const start = () => {
            if (props.disabled) return
            
            if (!camera.value) {
                alert("No Cameras Found")
                return
            }

            isActive.value = true
            
            if (scanner.value && preview.value) {
                scanner.value
                    .decodeFromInputVideoDevice(camera.value.deviceId, preview.value)
                    .then(onscan)
                    .catch((err) => {
                        console.error('QR Scanner error:', err)
                        stop()
                    })
            }
        }

        const onscan = (result: any) => {
            emit("change", result.text)
            stop()
        }

        const stop = () => {
            if (scanner.value) {
                scanner.value.reset()
            }
            isActive.value = false
        }

        onMounted(() => {
            const codeReader = new BrowserQRCodeReader()
            
            codeReader
                .listVideoInputDevices()
                .then((videoInputDevices) => {
                    if (videoInputDevices.length > 0) {
                        camera.value = videoInputDevices[0]
                    }
                })
                .catch((err) => {
                    console.error('Failed to list video devices:', err)
                })

            scanner.value = codeReader
        })

        return {
            scanner,
            camera,
            isActive,
            preview,
            fa_spinner,
            fa_times,
            start,
            stop
        }
    }
})

export { QrReader }
export default QrReader
</script>
<style scoped>
    .qr_reader{
        position: relative;
        font-family: "Courier";
    }
    .qr_popup{
        position: fixed;
        max-width: 80%;
        overflow: hidden;
        left: calc(50% - 200px);
        top: 40%;
        width: 400px;
        /*transform: translateX(-50%);*/
        /*transform: translate(-50%, -50%);*/
        z-index: 10;
        background-color: #202020;
        border: 4px solid;
    }

    .qr_popup video{
        width: 100%;
        /*width: 400px;*/
        /*height: 100%;*/
        z-index: 2;
        /*max-width: 100%;*/
    }

    .qr_popup button{
        border: none;
        position: absolute;
        top: 6px;
        right: 12px;
        z-index: 2;
        background-color: #222;
        color: #fff;
        border-radius: 25px;
        width: 25px;
        /*line-height: 25px;*/
        font-size: 14px;
        height: 25px;
        opacity: 0.7;
    }

    .qr_popup button:hover{
        opacity: 1;
    }

    .buts{
        height: 100%;
        opacity: 0.8;
    }
    .buts:hover{
        opacity: 1;
    }
    .buts[disabled]{
        opacity: 0.8;
        cursor: default;
    }

    .clickStart{
        cursor: pointer;
        position: absolute;
        width: 100%;
        height: 100%;
    }

    .loading{
        /*fill: #fc0;*/
        color: #ffcc66;
        width: 25px;
        /*filter: invert(98%) sepia(96%) saturate(5177%) hue-rotate(309deg) brightness(101%) contrast(112%);*/
        animation: spin 2s linear infinite;
    }

    .qr_slot{
        opacity: 0.1;
        cursor: pointer;
        pointer-events: none;
        /*user-select: none;*/
        /*pointer-events: none;*/
    }

    .clickStart:hover .qr_slot{
        opacity: 1;
    }

    .progress{
        text-align: center;
        position: absolute;
        bottom: 15px;
        left: 50%;
        transform: translateX(-50%);
        background-color: #202020d0;
        padding: 3px 7px;
    }
    .progress p{
        font-size: 12px;
        margin: 0;
        color: #fff;
        border-radius: 3px;
    }

    @keyframes spin {
        100% {
            transform: rotate(360deg);
        }
    }


    @media only screen and (max-width: 600px) {
        .qr_popup{
            top: 0;
            left: 0;
            width: 100vw;
            max-width: none;
            height: 100%;
            /*min-height: 100vh;*/
            /*min-height: max-content9;*/
        }

        .qr_popup video{
            width: auto;
            /*height: 100%;*/
            /*width: 100%;*/
            height: 100%;
            margin: 0 auto;
        }
    }
</style>
