/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useThrModalStore = defineStore('thrModal', () => {
    const isVisible = ref(false)
    const message = ref<string>(
        'Your AVXTO balance on this account is below the required minimum. Please acquire more AVXTO to use this feature.'
    )

    const show = (msg?: string) => {
        if (msg) message.value = msg
        isVisible.value = true
    }

    const hide = () => {
        isVisible.value = false
    }

    return { isVisible, message, show, hide }
})
