<template>
    <div class="nft_allow">
        <button @click="show" v-if="!isSmall">
            <fa icon="eye"></fa>
            <br />
            Show
        </button>
        <button @click="show" v-else>
            <fa icon="eye"></fa>
        </button>
    </div>
</template>
<script lang="ts">
import { defineComponent } from 'vue'
import { useAssetsStore } from '@/stores'

export default defineComponent({
    name: 'NftPayloadAllow',
    props: {
        nftID: {
            type: String,
            required: true
        },
        isSmall: {
            type: Boolean,
            default: false
        },
        modelValue: {
            type: Boolean,
            required: true
        }
    },
    emits: ['update:modelValue', 'change'],
    setup(props, { emit }) {
        const assetsStore = useAssetsStore()
        const show = () => {
            assetsStore.whitelistNFT(props.nftID)
            emit('update:modelValue', true)
            emit('change', true)
        }

        return {
            show
        }
    }
})
</script>
<style scoped lang="scss">
.nft_allow {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background-color: var(--bg-light);

    button {
        font-size: 0.8em;
        opacity: 0.5;

        &:hover {
            opacity: 1;
        }
    }
}
</style>
