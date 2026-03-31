import { defineStore } from 'pinia'
import { ref } from 'vue'

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

    /**
     * Show a status message in the status bar.
     */
    const setStatus = (msg: string, statusType: StatusBarType = 'info', showLoading = false) => {
        message.value = msg
        type.value = statusType
        loading.value = showLoading
        visible.value = true
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

    return {
        message,
        type,
        visible,
        loading,
        setStatus,
        info,
        success,
        warning,
        error,
        clear,
    }
})
