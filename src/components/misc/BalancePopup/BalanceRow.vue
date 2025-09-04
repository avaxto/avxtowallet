<template>
    <div class="bal_row">
        <p class="symbol">{{ symbol }}</p>
        <p class="name">{{ name }}</p>
        <p class="amt">{{ asset.toString() }}</p>
    </div>
</template>
<script lang="ts">
import { defineComponent, computed } from 'vue'
import AvaAsset from '@/js/AvaAsset'

export default defineComponent({
    name: 'BalanceRow',
    props: {
        asset: {
            type: Object as () => AvaAsset,
            required: true
        }
    },
    setup(props) {
        const name = computed(() => {
            let name = props.asset.name
            return name
        })

        const symbol = computed(() => {
            let sym = props.asset.symbol
            return sym
        })

        return {
            name,
            symbol
        }
    }
})
</script>
<style scoped lang="scss">
@use '../../../main';

.symbol {
    background-color: var(--bg-light);
    border-radius: 6px;
    padding: 2px 6px;
    font-size: 11px;
    align-self: center;
    text-align: center;
}

.name {
    overflow: auto;
    text-overflow: ellipsis;
    align-self: center;
    white-space: nowrap;
    text-align: left;
}

.amt {
    text-align: right;
}

@include main.mobile-device {
}
</style>
