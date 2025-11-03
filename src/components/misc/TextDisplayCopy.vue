<template>
    <div class="display_copy">
        <input class="disp" type="text" disabled :value="value" />
        <copy-text :value="value" class="copy" @copy="oncopy">
            <fa icon="copy"></fa>
        </copy-text>
    </div>
</template>
<script>
//@ts-ignore
import VueComponents from '@avalabs/vue_components'
//@ts-ignore
const { CopyText } = VueComponents
import { useStore } from '@/stores'

export default {
    components: {
        CopyText,
    },
    props: {
        value: {
            type: String,
            required: true,
        },
    },
    setup() {
        const store = useStore()
        
        return {
            store
        }
    },
    methods: {
        oncopy(val) {
            this.store.dispatch('Notifications/add', {
                title: 'Copy',
                message: 'Copied to clipboard.',
            })
            this.$emit('copy', this.value)
        },
    },
}
</script>
<style scoped>
.display_copy {
    display: flex;
    background-color: #e2e2e2;
    border-radius: 2px;
    overflow: hidden;
    border: 1px solid #d2d2d2;
}

.disp {
    padding: 6px;
    flex-grow: 1;
    text-align: center;
}

.copy {
    width: 50px;
    background-color: #cecece;
    color: #676767;
}

.copy:hover {
    background-color: #f2f2f2;
    color: #42b983;
}
</style>
