<template>
    <div>
        <div class="networks_list">
            <network-row
                data-cy="network-item"
                v-for="net in networks"
                :key="net.id"
                class="network_row"
                :network="net"
                @edit="onEdit(net)"
            ></network-row>
        </div>
    </div>
</template>
<script lang="ts">
import 'reflect-metadata'
import { defineComponent, computed } from 'vue'
import { useStore } from 'vuex'

import NetworkRow from './NetworkRow.vue'
import { AvaNetwork } from '@/js/AvaNetwork'

export default defineComponent({
    name: 'ListPage',
    components: {
        NetworkRow,
    },
    emits: ['edit'],
    setup(_, { emit }) {
        const store = useStore()

        const networks = computed((): AvaNetwork[] => {
            return store.getters['Network/allNetworks']
        })

        const onEdit = (net: AvaNetwork) => {
            emit('edit', net)
        }

        return {
            networks,
            onEdit
        }
    }
})
</script>
<style scoped lang="scss">
.networks_list {
    padding: 0px 15px;
}
</style>
