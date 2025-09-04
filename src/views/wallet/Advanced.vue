<template>
    <div>
        <div>
            <h1>{{ $t('advanced.title') }}</h1>
        </div>
        <TokenListModal ref="token_list"></TokenListModal>
        <!--        <div class="buts grid_box">-->
        <!--            <button @click="openTokenlist">Manage Token Lists</button>-->
        <!--        </div>-->
        <div class="grids">
            <ChainImport class="grid_box"></ChainImport>
            <SignMessage class="grid_box"></SignMessage>
            <VerifyMessage class="grid_box"></VerifyMessage>
        </div>
    </div>
</template>
<script lang="ts">
import { defineComponent, ref } from 'vue'

import ChainImport from '@/components/wallet/advanced/ChainImport.vue'
import SignMessage from '@/components/wallet/advanced/SignMessage/SignMessage.vue'
import VerifyMessage from '@/components/wallet/advanced/VerifyMessage.vue'
import TokenListModal from '@/components/modals/TokenList/TokenListModal.vue'

export default defineComponent({
    name: 'advanced',
    components: {
        TokenListModal,
        ChainImport,
        SignMessage,
        VerifyMessage,
    },
    setup() {
        const token_list = ref<InstanceType<typeof TokenListModal>>()

        const openTokenlist = () => {
            token_list.value?.open()
        }

        return {
            token_list,
            openTokenlist,
        }
    }
})
</script>
<style scoped lang="scss">
@use '../../main';

h1 {
    font-weight: normal;
}
.grids {
    display: grid;
    column-gap: 14px;
    row-gap: 14px;
    grid-template-columns: repeat(3, 1fr);
}

.grid_box {
    background-color: var(--bg-light);
    padding: 30px;
    border-radius: 4px;
    overflow: auto;
}

@include main.mobile-device {
    .grids {
        grid-template-columns: none;
    }
}

@include main.medium-device {
    .grids {
        grid-template-columns: none;
    }
}

.buts {
    margin-bottom: 12px;
    button {
        color: var(--primary-color);
        &:hover {
            color: var(--secondary-color);
        }
    }
}
</style>
