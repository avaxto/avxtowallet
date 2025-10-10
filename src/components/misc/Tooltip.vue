<template>
    <div>
        <v-tooltip bottom>
            <template v-slot:activator="{ props: activatorProps }">
                <button v-bind="filterProps(activatorProps)">
                    <slot></slot>
                </button>
            </template>
            <span>{{ text }}</span>
        </v-tooltip>
    </div>
</template>
<script>
export default {
    props: {
        text: String,
    },
    methods: {
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
    }
}
</script>
