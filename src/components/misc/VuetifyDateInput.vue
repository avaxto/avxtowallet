<template>
    <v-layout row wrap>
        <v-menu
            :model-value="fromDateMenu"
            @update:model-value="fromDateMenu = $event"
            :close-on-content-click="false"
            transition="scale-transition"
            offset-y
        >
            <template v-slot:activator="{ props: activatorProps }">
                <v-text-field
                    :label="label"
                    readonly
                    :value="fromDateDisp"
                    v-bind="filterProps(activatorProps)"
                    hide-details
                ></v-text-field>
            </template>
            <v-date-picker
                locale="en-in"
                :min="minDate"
                :max="maxDate"
                :model-value="dateVal"
                @update:model-value="dateVal = $event"
                no-title
                @input="dateIn"
            ></v-date-picker>
        </v-menu>
    </v-layout>
</template>
<script lang="ts">
import { defineComponent, ref, computed, watch } from 'vue'

export default defineComponent({
    name: 'VuetifyDateInput',
    props: {
        label: {
            type: String,
            default: ''
        },
        minDate: {
            type: String,
            default: ''
        },
        maxDate: {
            type: String,
            default: ''
        },
    },
    emits: ['change'],
    setup(props, { emit }) {
        const fromDateMenu = ref(false)
        const dateVal = ref<string | null>(null)

        const fromDateDisp = computed(() => {
            return dateVal.value
            // format date, apply validations, etc. Example below.
            // return dateVal.value ? formatDate(dateVal.value) : "";
        })

        const dateIn = () => {
            fromDateMenu.value = false
            // console.log(dateVal.value);
        }

        const filterProps = (props: any) => {
            if (!props) return {}
            // Filter out any numeric keys that could cause setAttribute errors
            const filtered: any = {}
            for (const key in props) {
                if (!/^\d+$/.test(key)) {
                    filtered[key] = props[key]
                }
            }
            return filtered
        }

        watch(dateVal, (val) => {
            // console.log(val);
            emit('change', val)
        })

        return {
            fromDateMenu,
            dateVal,
            fromDateDisp,
            dateIn,
            filterProps
        }
    }
})
</script>
<style scoped lang="scss">
.layout {
    margin: 0;
}
</style>
