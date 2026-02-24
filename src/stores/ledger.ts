import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

interface ModalData {
    title: string
    warning?: string
    messages?: string[]
    info?: string
    isPrompt?: boolean
}

export const useLedgerStore = defineStore('ledger', () => {
    // State
    const isBlock = ref(false)
    const isModalOpen = ref(false)
    const modalData = ref<ModalData | null>(null)
    const isUpgradeRequired = ref(false)
    const isWalletLoading = ref(false)

    // Convenience getters (components access these directly instead of modalData.*)
    const title = computed(() => modalData.value?.title ?? '')
    const info = computed(() => modalData.value?.info ?? '')
    const messages = computed(() => modalData.value?.messages ?? [])
    const warning = computed(() => modalData.value?.warning ?? '')
    const isPrompt = computed(() => modalData.value?.isPrompt ?? false)

    // Actions
    const openModal = (data: ModalData) => {
        modalData.value = data
        isModalOpen.value = true
        isBlock.value = true
    }

    const closeModal = () => {
        modalData.value = null
        isModalOpen.value = false
        isBlock.value = false
    }

    const setIsUpgradeRequired = (val: boolean) => {
        isUpgradeRequired.value = val
    }

    const setIsWalletLoading = (val: boolean) => {
        isWalletLoading.value = val
    }

    return {
        // State
        isBlock,
        isModalOpen,
        modalData,
        isUpgradeRequired,
        isWalletLoading,

        // Getters
        title,
        info,
        messages,
        warning,
        isPrompt,

        // Actions
        openModal,
        closeModal,
        setIsUpgradeRequired,
        setIsWalletLoading,
    }
})