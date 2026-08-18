<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<template>
    <div class="token_list_picker">
        <input
            v-model="searchQuery"
            type="text"
            class="token_search_input"
            placeholder="Search token…"
            autofocus
        />
        <div class="token_list_scroll no_scroll_bar">
            <div v-if="loading" class="token_list_loading">
                <Spinner class="token_list_spinner"></Spinner>
                Loading tokens…
            </div>
            <div v-if="!filtered.length && !loading" class="token_list_empty">No matches</div>
            <div
                v-for="t in filtered"
                :key="tokenKey(t)"
                class="token_list_item"
                :class="{ active: isSelected(t) }"
                @click="$emit('select', t)"
            >
                <img v-if="t.logoUri" :src="t.logoUri" class="token_list_logo" />
                <div v-else class="token_list_logo placeholder">?</div>
                <div class="token_list_name">
                    <p>
                        {{ t.symbol }}
                        <span
                            v-if="t.network"
                            class="token_net_chip"
                            :style="{ borderColor: t.network.color }"
                        >
                            <span
                                class="token_net_dot"
                                :style="{ backgroundColor: t.network.color }"
                            ></span>
                            {{ t.network.shortName }}
                        </span>
                    </p>
                    <p>{{ t.name }}</p>
                </div>
                <p class="token_list_balance" :title="t.balance.toLocaleString()">{{ t.balance.toLocaleString() }}</p>
            </div>
        </div>
    </div>
</template>
<script lang="ts">
import { defineComponent, ref, computed, type PropType } from 'vue'
import Spinner from '@/components/misc/Spinner.vue'
import type { HeldToken } from '@/composables/useHeldErc20Tokens'

// Reusable search + list body for picking a held ERC20 (or native AVAX)
// token — the same widget backs both Swap's "you pay" picker and the
// transfer page's token picker, so both read from the same merged
// (Default Assets + SDK-discovered) token list and neither omits what the
// other shows. Deliberately just the search input + list: callers own the
// surrounding chrome (Swap wraps it in a button-anchored popover, transfer
// wraps it in a Modal), since only that part differs between the two.
export default defineComponent({
    name: 'TokenListPicker',
    components: { Spinner },
    props: {
        tokens: {
            type: Array as PropType<HeldToken[]>,
            required: true,
        },
        selectedAddress: {
            type: String,
            default: '',
        },
        loading: {
            type: Boolean,
            default: false,
        },
    },
    emits: ['select'],
    setup(props) {
        const searchQuery = ref('')

        const filtered = computed((): HeldToken[] => {
            const q = searchQuery.value.trim().toLowerCase()
            if (!q) return props.tokens
            return props.tokens.filter(
                (t) =>
                    t.symbol.toLowerCase().includes(q) ||
                    t.name.toLowerCase().includes(q) ||
                    t.address.toLowerCase().includes(q) ||
                    (t.network?.shortName.toLowerCase().includes(q) ?? false)
            )
        })

        /**
         * List identity. Scoped by chain id when the token carries a network:
         * the same contract address exists on several chains, so an
         * address-only key would collide and Vue would reuse the wrong row.
         */
        const tokenKey = (t: HeldToken): string =>
            t.network ? `${t.network.evmChainId}:${t.address.toLowerCase()}` : t.address

        const isSelected = (t: HeldToken): boolean => {
            return !!props.selectedAddress && t.address.toLowerCase() === props.selectedAddress.toLowerCase()
        }

        return { searchQuery, filtered, tokenKey, isSelected }
    },
})
</script>
<style scoped lang="scss">
.token_list_picker {
    width: 100%;
}

.token_net_chip {
    display: inline-flex;
    align-items: center;
    margin-left: 6px;
    font-size: 10px;
    white-space: nowrap;
    color: var(--primary-color-light);
    border: 1px solid var(--bg-light);
    border-radius: 9px;
    padding: 0 6px 0 4px;
    vertical-align: middle;
}

.token_net_dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    margin-right: 4px;
    flex-shrink: 0;
}

.token_search_input {
    width: 100%;
    border: none;
    border-bottom: 1px solid #d3d3d3;
    padding: 10px 12px;
    font-size: 13px;
    background: transparent;
    color: var(--primary-color);

    &:focus {
        outline: none;
    }
}

.token_list_scroll {
    max-height: 320px;
    overflow-y: auto;
}

.token_list_item {
    display: grid;
    // Balance used to be `max-content` — a very large balance (e.g.
    // "123,456,789.123456") would grow as wide as it needed and squeeze the
    // 1fr name column down to nothing. Capping it and truncating with
    // ellipsis keeps the name legible regardless of balance size.
    grid-template-columns: max-content 1fr minmax(0, 90px);
    column-gap: 12px;
    align-items: center;
    padding: 9px 12px;
    font-size: 14px;
    cursor: pointer;
    user-select: none;

    &:hover {
        background: var(--bg-light);
    }

    &.active {
        background: var(--bg-light);
        color: var(--secondary-color);
    }
}

$logo_w: 32px;

.token_list_logo {
    width: $logo_w;
    height: $logo_w;
    border-radius: $logo_w;
    object-fit: contain;

    &.placeholder {
        background-color: var(--bg-light);
        text-align: center;
        line-height: $logo_w;
        color: var(--primary-color-light);
    }
}

.token_list_name {
    min-width: 0;

    p {
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--primary-color);

        &:last-of-type {
            font-size: 12px;
            font-weight: 400;
            color: var(--primary-color-light);
        }
    }
}

.token_list_balance {
    text-align: right;
    font-size: 13px;
    color: var(--primary-color-light);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.token_list_empty {
    padding: 12px;
    font-size: 13px;
    color: var(--primary-color-light);
    text-align: center;
}

.token_list_loading {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    font-size: 13px;
    color: var(--primary-color-light);
    border-bottom: 1px solid #d3d3d3;
}

.token_list_spinner {
    width: 14px !important;
    height: 14px !important;
}
</style>
