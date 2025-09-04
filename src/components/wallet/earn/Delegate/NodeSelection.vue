<template>
    <div class="node_selection">
        <div style="display: flex; align-items: center; justify-content: space-between">
            <div style="display: flex; align-items: center">
                <p>{{ $t('earn.delegate.list.prompt') }}:</p>
                <input
                    class="search"
                    type="text"
                    :placeholder="$t('earn.delegate.list.search')"
                    v-model="search"
                />
            </div>

            <div class="rigt_but">
                <button @click="openFilters">
                    {{ $t('earn.delegate.filter.title') }}
                    <fa icon="filter"></fa>
                </button>
            </div>
        </div>
        <ValidatorsList
            class="val_list"
            :search="search"
            @select="onselect"
            ref="val_list"
        ></ValidatorsList>
    </div>
</template>
<script lang="ts">
import { defineComponent, ref } from 'vue'

import ValidatorsList from '@/components/misc/ValidatorList/ValidatorsList.vue'
import { ValidatorListItem } from '@/store/modules/platform/types'

export default defineComponent({
    name: 'NodeSelection',
    components: {
        ValidatorsList,
    },
    emits: ['select'],
    setup(props, { emit }) {
        const search = ref('')
        const val_list = ref<InstanceType<typeof ValidatorsList> | null>(null)

        const openFilters = () => {
            val_list.value?.openFilters()
        }

        const onselect = (val: ValidatorListItem) => {
            emit('select', val)
        }

        return {
            search,
            val_list,
            openFilters,
            onselect
        }
    }
})
</script>
<style scoped lang="scss">
.node_selection {
    display: grid;
    overflow: auto;
    row-gap: 14px;
    grid-template-rows: max-content 1fr;
}

.val_list {
    overflow: auto;
    height: 100%;
    /*margin-top: 14px;*/
}

.search {
    padding: 3px 12px;
    border-radius: 12px;
    background-color: var(--bg-light);
    margin-left: 30px;
    color: var(--primary-color);
}

.rigt_but {
    float: right;

    button {
        color: var(--primary-color-light);

        &:hover {
            color: var(--primary-color);
        }
    }
}
</style>
