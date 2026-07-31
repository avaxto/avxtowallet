/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

// Only three signal colors, per the log's design — 'info' folds into 'green'
// since it isn't a warning or an error.
export type LogDotColor = 'green' | 'yellow' | 'red'
export type LogSource = 'notification' | 'statusbar'

export interface LogEntry {
    id: number
    color: LogDotColor
    time: number // Date.now()
    message: string
    source: LogSource
}

const COLOR_MAP: Record<string, LogDotColor> = {
    success: 'green',
    info: 'green',
    warning: 'yellow',
    error: 'red',
}

export const useSessionLogStore = defineStore('sessionlog', () => {
    // State — in-memory only, so it's naturally ephemeral: logout does a
    // full page reload (see mainStore.logout), which resets this for free.
    const entries = ref<LogEntry[]>([])

    // Getters
    const sortedEntries = computed((): LogEntry[] => {
        return [...entries.value].sort((a, b) => b.time - a.time)
    })

    // Actions
    const log = (type: string | undefined, message: string, source: LogSource) => {
        entries.value.push({
            id: Date.now() + Math.random(),
            color: COLOR_MAP[type || 'info'] || 'green',
            time: Date.now(),
            message,
            source,
        })
    }

    const reset = () => {
        entries.value = []
    }

    return {
        entries,
        sortedEntries,
        log,
        reset,
    }
})
