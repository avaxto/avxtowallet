<template>
    <modal ref="modal" title="Accessing Ledger Device" :can_close="false">
        <div class="ledger_block" v-if="isActive">
            <p v-if="isPrompt" style="font-size: 18px">
                {{ $t('modal.ledger.desc') }}
            </p>
            <p class="alert" v-if="warning">{{ warning }}</p>

            <p class="message">{{ title }}</p>
            <p class="message" v-if="info">{{ info }}</p>
            <template v-else>
                <div class="message block" v-for="(message, i) in messages" :key="i">
                    <p class="title">{{ message.title }}</p>
                    <p class="value">{{ message.value }}</p>
                </div>
            </template>
            <Spinner class="spinner"></Spinner>
        </div>
    </modal>
</template>
<script lang="ts">
import 'reflect-metadata'
import { defineComponent, computed, watch, ref } from 'vue'
import { useStore } from 'vuex'

import Spinner from '@/components/misc/Spinner.vue'
import Modal from './Modal.vue'
import { ILedgerBlockMessage } from '../../store/modules/ledger/types'
import { LEDGER_EXCHANGE_TIMEOUT } from '../../store/modules/ledger/types'

export default defineComponent({
    name: 'LedgerBlock',
    components: {
        Modal,
        Spinner,
    },
    setup() {
        const store = useStore()
        
        const intervalId = ref<ReturnType<typeof setTimeout> | null>(null)
        const modal = ref<InstanceType<typeof Modal>>()

        const open = () => {
            if (modal.value) {
                modal.value.open()
            }
        }

        const close = () => {
            if (modal.value) {
                modal.value.close()
            }
        }

        const title = computed((): string => {
            return store.state.Ledger.title
        })

        const info = computed((): string => {
            return store.state.Ledger.info
        })

        const messages = computed((): Array<ILedgerBlockMessage> => {
            return store.state.Ledger.messages
        })

        const isActive = computed((): boolean => {
            return store.state.Ledger.isBlock
        })

        const isPrompt = computed((): boolean => {
            return store.state.Ledger.isPrompt
        })

        const warning = computed(() => {
            return store.state.Ledger.warning
        })

        watch(isActive, (val: boolean) => {
            if (!modal.value) return
            if (val) {
                open()
            } else {
                close()
            }
        }, { immediate: true })

        return {
            intervalId,
            modal,
            open,
            close,
            title,
            info,
            messages,
            isActive,
            isPrompt,
            warning
        }
    }
})
</script>
<style scoped lang="scss">
.ledger_block {
    pointer-events: none;
    padding: 30px;
    max-width: 600px;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
}

.message .title {
    line-height: 1rem;
    font-size: 0.8rem !important;
    color: var(--primary-color-light);
}

.alert {
    color: var(--error);
}

.message {
    padding: 12px;
    color: var(--primary-color);
    width: 100%;
    margin: 4px 0 !important;
    word-break: break-all;
    background-color: var(--bg-wallet);
}

.message.block {
    text-align: left;
    padding: 6px 12px;
}

.message.desc {
    padding: 6px;
    margin-top: 2px;
    margin-bottom: 8px;
    font-size: 1rem;
}

.spinner {
    width: 40px;
    font-size: 20px !important;
    margin: 20px auto !important;
    color: var(--primary-color) !important;
}
</style>
