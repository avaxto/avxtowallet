<template>
    <div class="currency_select">
        <button @click="setType('AVAX')" :active="modelValue === 'AVAX'">AVAX</button>
        <button @click="setType('USD')" :active="modelValue === 'USD'">USD</button>
    </div>
</template>
<script lang="ts">
import { defineComponent } from 'vue'
import { CurrencyType } from '@/components/misc/CurrencySelect/types'

export default defineComponent({
    name: 'CurrencySelect',
    props: {
        modelValue: {
            type: String as () => CurrencyType,
            required: true
        }
    },
    emits: ['update:modelValue', 'change'],
    setup(props, { emit }) {
        const setType = (val: CurrencyType) => {
            emit('update:modelValue', val)
            emit('change', val)
        }

        return {
            setType
        }
    }
})
</script>
<style scoped lang="scss">
.currency_select {
    display: flex;
    width: max-content;
    background-color: var(--bg-light);
    border-radius: 4px;
    overflow: hidden;
}

button {
    margin: 0;
    border-radius: 0;
    padding: 3px 6px;
    font-size: 12px;
    color: var(--primary-color-light);
    transition-duration: 0.2s;

    &:hover {
        background-color: var(--primary-color-light);
        color: var(--bg);
    }

    &[active] {
        background-color: var(--primary-color);
        color: var(--bg);
    }
}
</style>
