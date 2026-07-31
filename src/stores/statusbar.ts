/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useSessionLogStore } from './sessionlog'

export type StatusBarType = 'info' | 'success' | 'warning' | 'error'

export interface StatusBarState {
    message: string
    type: StatusBarType
    visible: boolean
    loading: boolean
}

export const useStatusBarStore = defineStore('statusbar', () => {
    const message = ref('')
    const type = ref<StatusBarType>('info')
    const visible = ref(false)
    const loading = ref(false)

    // Right-side status — a separate, independent slot pinned to the far
    // right of the bar (like the clock in a Windows taskbar). It doesn't
    // interact with the left-side message/type/visible/loading state above:
    // it can be set and stays put regardless of what's happening on the left.
    const rightMessage = ref('')

    /**
     * Show a status message in the status bar.
     */
    const setStatus = (msg: string, statusType: StatusBarType = 'info', showLoading = false) => {
        message.value = msg
        type.value = statusType
        loading.value = showLoading
        visible.value = true

        useSessionLogStore().log(statusType, msg, 'statusbar')
    }

    /** Convenience: show an info message. */
    const info = (msg: string, showLoading = false) => setStatus(msg, 'info', showLoading)

    /** Convenience: show a success message. */
    const success = (msg: string) => setStatus(msg, 'success', false)

    /** Convenience: show a warning message. */
    const warning = (msg: string) => setStatus(msg, 'warning', false)

    /** Convenience: show an error message. */
    const error = (msg: string) => setStatus(msg, 'error', false)

    /** Hide the status bar. */
    const clear = () => {
        visible.value = false
        loading.value = false
        message.value = ''
    }

    /** Set the far-right status text (persists until changed or cleared). */
    const setRightStatus = (msg: string) => {
        rightMessage.value = msg
    }

    /** Clear the far-right status text. */
    const clearRightStatus = () => {
        rightMessage.value = ''
    }

    return {
        message,
        type,
        visible,
        loading,
        rightMessage,
        setStatus,
        info,
        success,
        warning,
        error,
        clear,
        setRightStatus,
        clearRightStatus,
    }
})
