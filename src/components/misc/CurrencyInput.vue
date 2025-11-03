<template>
    <div class="curr_in" :disabled="disabled">
        <button v-if="canMax" @click="maxOut">MAX</button>
        <input
            type="number"
            :min="minVal"
            :step="tick_size"
            placeholder="0.00"
            :value="value"
            @input="handleInput"
            ref="inputRef"
        />
        <p>{{ currency }}</p>
    </div>
</template>
<script lang="ts">
import { defineComponent, computed, ref } from 'vue'

export default defineComponent({
    name: 'CurrencyInput',
    props: {
        currency: {
            type: String,
            required: true,
        },
        value: {
            type: Number,
            default: 0
        },
        disabled: {
            type: Boolean,
            default: false,
        },
        precision: {
            type: Number,
            default: 2,
        },
        tick_size: {
            type: Number,
            default: null,
        },
        maxVal: {
            type: Number,
            default: null,
        },
    },
    emits: ['change'],
    setup(props, { emit }) {
        const inputRef = ref<HTMLInputElement>()

        const canMax = computed(() => {
            return props.maxVal != null
        })

        const minVal = computed(() => {
            if (props.tick_size) return props.tick_size
            return 0
        })

        const handleInput = () => {
            if (!inputRef.value) return
            let val = parseFloat(inputRef.value.value)

            if (canMax.value && props.maxVal) {
                let max = props.maxVal
                if (val > max && max != 0) {
                    val = max
                }
            }

            emit('change', val)
        }

        const maxOut = () => {
            emit('change', props.maxVal)
        }

        return {
            inputRef,
            canMax,
            minVal,
            handleInput,
            maxOut
        }
    }
})
</script>
<style scoped>
.curr_in[disabled] {
    opacity: 0.3;
    user-select: none;
    pointer-events: none;
}
.curr_in {
    margin: 2px 0px;
    background-color: #413e44;
    display: flex;
    font-size: 12px;
    color: #d2d2d2;
    align-items: center;
    min-height: 28px;
}

.curr_in button {
    padding: 0px 15px;
    outline: none;
    text-decoration: underline;
}

.curr_in_tog {
    border-left: 1px solid #3a3144;
    box-shadow: none;
    background-color: transparent !important;
}
input {
    text-align: right;
    outline: none;
    flex-grow: 1;
    /*width: calc(100% - 20px);*/
}
p {
    flex-basis: 40px;
    margin: 0 !important;
    font-weight: bold;
    text-align: center;
}

.v-btn {
    border-radius: 0;
    color: #d2d2d2;
}
</style>
