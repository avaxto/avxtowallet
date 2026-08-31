/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
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

    /**
     * Closes down the Ledger prompt state.
     *
     * All transient, but all capable of outliving the session that opened it:
     * logging out midway through a device prompt used to be impossible to do
     * without a reload, so a modal left open simply went away with the page.
     * It no longer does, and a Ledger dialog floating over a logged-out wallet
     * — or worse, over a different platform's tab — is the result.
     */
    const resetSession = () => {
        isBlock.value = false
        isModalOpen.value = false
        modalData.value = null
        isUpgradeRequired.value = false
        isWalletLoading.value = false
    }

    return {
        // State
        isBlock,
        isModalOpen,
        modalData,
        isUpgradeRequired,
        isWalletLoading,

        resetSession,

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