<template>
    <div class="utxo_select">
        <div class="buts">
            <button @click="select('all')" :selected="selected === 'all'">All</button>
            <button @click="select('unlocked')" :selected="selected === 'unlocked'">
                Unlocked
            </button>
            <button @click="select('locked')" :selected="selected === 'locked'">Locked</button>
        </div>
    </div>
</template>
<script lang="ts">
import { defineComponent, ref, computed } from 'vue'
import { UTXOSet } from 'avalanche/dist/apis/platformvm'
import { UnixNow } from 'avalanche/dist/utils'

type Selection = 'all' | 'unlocked' | 'locked'

export default defineComponent({
    name: 'UTXOSelect',
    props: {
        utxos: {
            type: Object as () => UTXOSet,
            required: true
        }
    },
    emits: ['change'],
    setup(props, { emit }) {
        const selected = ref<Selection>('all')

        const select = (type: Selection) => {
            selected.value = type
            emit('change', selectedSet.value)
        }

        const unlocked = computed((): UTXOSet => {
            let utxos = props.utxos.getAllUTXOs()
            let res = new UTXOSet()
            let now = UnixNow()
            for (var i = 0; i < utxos.length; i++) {
                let utxo = utxos[i]
                let out = utxo.getOutput()
                let type = out.getOutputID()
                if (type !== 22) {
                    let locktime = out.getLocktime()
                    if (locktime.lt(now)) {
                        res.add(utxo)
                    }
                }
            }
            return res
        })

        const locked = computed((): UTXOSet => {
            return props.utxos.difference(unlocked.value)
        })

        const selectedSet = computed(() => {
            switch (selected.value) {
                case 'all':
                    return props.utxos
                case 'unlocked':
                    return unlocked.value
                case 'locked':
                    return locked.value
            }
            return props.utxos
        })

        return {
            selected,
            select,
            selectedSet,
            unlocked,
            locked
        }
    }
})
</script>
<style scoped lang="scss">
.utxo_select {
    display: flex;
    margin: 4px 0;
    button {
        font-size: 13px;
        padding: 4px 8px;
        background-color: var(--bg-light);
        &[selected] {
            background-color: var(--primary-color);
            color: var(--bg);
        }
    }
}
.buts {
    border-radius: 4px;
    overflow: hidden;
}
</style>
