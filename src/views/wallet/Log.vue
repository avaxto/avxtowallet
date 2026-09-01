<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<template>
    <div class="log_page">
        <h1>AVXTO Wallet Log</h1>
        <p class="desc">
            System log for this wallet session. This log is ephemeral — it lives only in memory and resets when you log out.
        </p>

        <div class="card">
            <div class="table_head_row">
                <h2>{{ entries.length }} {{ entries.length === 1 ? 'entry' : 'entries' }}</h2>
                <button class="clear_btn" :disabled="!entries.length" @click="sessionLog.reset()">
                    Clear
                </button>
            </div>

            <p v-if="!entries.length" class="state_msg">Nothing logged yet this session.</p>

            <div v-else class="log_table">
                <div class="log_header">
                    <span></span>
                    <span>Time</span>
                    <span>Message</span>
                </div>
                <div v-for="e in entries" :key="e.id" class="log_row">
                    <span class="dot_cell">
                        <span class="dot" :class="e.color"></span>
                    </span>
                    <span class="time_cell">{{ formatTime(e.time) }}</span>
                    <span class="message_cell">{{ e.message }}</span>
                </div>
            </div>
        </div>
    </div>
</template>

<script lang="ts">
import { defineComponent, computed } from 'vue'
import { useSessionLogStore } from '@/stores'

export default defineComponent({
    name: 'log',
    setup() {
        const sessionLog = useSessionLogStore()

        const entries = computed(() => sessionLog.sortedEntries)

        const formatTime = (t: number): string => {
            return new Date(t).toLocaleTimeString()
        }

        return {
            sessionLog,
            entries,
            formatTime,
        }
    },
})
</script>

<style lang="scss" scoped>
.log_page {
    h1 {
        margin-bottom: 8px;
    }

    .desc {
        color: var(--primary-color-light);
        margin-bottom: 24px;
        line-height: 1.5;
    }
}

.card {
    background: var(--bg-light);
    border: 1px solid var(--bg-light);
    border-radius: 12px;
    padding: 24px;
}

.table_head_row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16px;

    h2 {
        margin: 0;
        font-size: 18px;
    }
}

.clear_btn {
    background: var(--bg);
    border: 1px solid #d3d3d3;
    border-radius: 8px;
    padding: 6px 14px;
    font-size: 13px;
    font-weight: 600;
    color: var(--primary-color);
    cursor: pointer;

    &:disabled {
        opacity: 0.5;
        cursor: default;
    }
}

.state_msg {
    color: var(--primary-color-light);
    padding: 20px 0;
    text-align: center;
}

.log_table {
    border: 1px solid var(--bg);
    border-radius: 8px;
    overflow: hidden;
    font-size: 13px;
    max-height: 60vh;
    overflow-y: auto;

    .log_header,
    .log_row {
        display: grid;
        grid-template-columns: 28px 100px 1fr;
        gap: 10px;
        padding: 8px 14px;
        align-items: center;
    }

    .log_header {
        background: var(--bg);
        font-weight: 700;
        font-size: 12px;
        color: var(--primary-color-light);
        text-transform: uppercase;
        letter-spacing: 0.03em;
        position: sticky;
        top: 0;
    }

    .log_row {
        border-top: 1px solid var(--bg);
    }

    .time_cell {
        font-family: monospace;
        color: var(--primary-color-light);
        white-space: nowrap;
    }

    .message_cell {
        // Explicit, not inherited: relying on inheritance for text color is
        // exactly what makes the h1-h6 and body rules in _main.scss need
        // `!important` — a same-specificity, later-loaded rule elsewhere
        // (bootstrap-vue-next's reboot, Vuetify) can win the cascade on an
        // ancestor and hand this element a light-theme (dark) color to
        // inherit instead. Setting it here removes the dependency entirely.
        color: var(--primary-color);
        word-break: break-word;
    }
}

.dot_cell {
    display: flex;
    justify-content: center;
}

.dot {
    display: inline-block;
    width: 9px;
    height: 9px;
    border-radius: 50%;

    &.green  { background-color: #4caf50; }
    &.yellow { background-color: #ff9800; }
    &.red    { background-color: #f44336; }
}

@media (max-width: 640px) {
    .log_table {
        .log_header,
        .log_row {
            grid-template-columns: 20px 76px 1fr;
        }
    }
}
</style>
