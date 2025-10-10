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
<script>
export default {
    props: {
        label: String,
        minDate: String,
        maxDate: String,
    },
    data() {
        return {
            fromDateMenu: false,
            dateVal: null,

            // minDate: "2019-07-04",
            // maxDate: "2019-08-30",
        }
    },
    computed: {
        fromDateDisp() {
            return this.dateVal
            // format date, apply validations, etc. Example below.
            // return this.fromDateVal ? this.formatDate(this.fromDateVal) : "";
        },
    },
    methods: {
        dateIn() {
            this.fromDateMenu = false
            // console.log(this.dateVal);
        },
        filterProps(props) {
            if (!props) return {}
            // Filter out any numeric keys that could cause setAttribute errors
            const filtered = {}
            for (const key in props) {
                if (!/^\d+$/.test(key)) {
                    filtered[key] = props[key]
                }
            }
            return filtered
        }
    },
    watch: {
        dateVal(val) {
            // console.log(val);
            this.$emit('change', val)
        },
    },
}
</script>
<style scoped lang="scss">
.layout {
    margin: 0;
}
</style>
