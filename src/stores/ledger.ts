import { defineStore } from 'pinia'
import { ref } from 'vue'

interface ModalData {
    title: string
    warning?: string
    messages?: string[]
    info?: string
}

export const useLedgerStore = defineStore('ledger', () => {
    // State
    const isBlock = ref(false)
    const isModalOpen = ref(false)
    const modalData = ref<ModalData | null>(null)

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

    return {
        // State
        isBlock,
        isModalOpen,
        modalData,
        
        // Actions
        openModal,
        closeModal
    }
})