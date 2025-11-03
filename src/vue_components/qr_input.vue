<template>
    <div class="qr_input">
        <QRReader class="readerIn" @change="change" :disabled="disabled">
            <button>
                <fa :icon="fa_camera"></fa>
            </button>
        </QRReader>
        <input type="text" class="pk_in" :placeholder="placeholder"
               v-model="pk" @input="oninput" :disabled="disabled">
    </div>
</template>
<script lang="ts">
import { defineComponent, ref, watch, onMounted } from 'vue'
import QRReader from "./qr_reader.vue"
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { faCamera } from '@fortawesome/free-solid-svg-icons'

const QrInput = defineComponent({
    name: 'QrInput',
    components: {
        QRReader,
        fa: FontAwesomeIcon
    },
    props: {
        placeholder: {
            type: String,
            default: ''
        },
        modelValue: {
            type: String,
            default: ''
        },
        disabled: {
            type: Boolean,
            default: false
        }
    },
    emits: ['update:modelValue'],
    setup(props, { emit }) {
        const pk = ref("")
        const fa_camera = faCamera

        watch(() => props.modelValue, (val) => {
            pk.value = val
        })

        onMounted(() => {
            pk.value = props.modelValue
        })

        const change = (val: string) => {
            pk.value = val
            emitValue()
        }

        const oninput = () => {
            pk.value = pk.value.trim()
            emitValue()
        }

        const emitValue = () => {
            emit('update:modelValue', pk.value)
        }

        return {
            pk,
            fa_camera,
            change,
            oninput
        }
    }
})

export { QrInput }
export default QrInput
</script>
<style scoped>
    .qr_input{
        display: flex;
        align-items: center;
        color: #333;
        height: 45px;
        background-color: #f8f8f8;
        margin-bottom: 8px;
    }

    .qr_input button{
        font-size: 19px;
        height: 100%;
        padding-right: 12px;
        padding-left: 12px;
        border-style: none;
        border-right: 1px solid #d2d2d2;
        text-align: center;
        pointer-events: none;
        opacity: 0.7;
        /*opacity: 0.7;*/
    }

    .readerIn{
        height: 100%;
    }

    .pk_in{
        background-color: transparent;
        border-style: none;
        color: inherit;
        outline: none;
        text-align: center;
        width: 100%;
        margin: 0;
        padding: 0px 12px;
    }
</style>
