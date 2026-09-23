<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<!--
  "You haven't burned enough AVXTO on Moats, here is where to do it."

  Shared by the two places the requirement is explained, so the text cannot
  drift between them: the standalone /insufficient-balance page (reached by
  its own route, and from the AVXTO menu while logged out) and the modal that
  gates individual actions inside the wallet — see
  components/modals/BaseAssetGateModal.vue and composables/useBaseAssetGate.

  Every value is a prop rather than read from a store here, because the two
  callers know different amounts: the modal has just read this wallet's burn,
  the page may have no session at all. `burnedValue` and `burnAddress` are
  optional for that reason, and the blocks that need them hide themselves.
-->
<template>
    <div class="insufficient_message">
        <p>
            This Premium feature requires burning
            <strong>{{ thrSymbol }}</strong>
            on
            <a :href="moatsUrl" target="_blank" rel="noopener noreferrer">Moats</a>
            .
        </p>

        <p v-if="thrValue">
            Minimum burned:
            <strong>{{ formatWhole(thrValue) }} {{ thrSymbol }}</strong>
            <template v-if="burnedValue !== ''">
                <br />
                Burned by this wallet so far:
                <strong>{{ formatWhole(burnedValue) }} {{ thrSymbol }}</strong>
            </template>
        </p>

        <p>
            <template v-if="remaining">
                Burn at least
                <strong>{{ remaining }} more {{ thrSymbol }}</strong>
            </template>
            <template v-else>
                Burn
                <strong>{{ thrValue ? formatWhole(thrValue) : '' }} {{ thrSymbol }}</strong>
            </template>
            at
            <a :href="moatsUrl" target="_blank" rel="noopener noreferrer">moats.app</a>
            to unlock the full wallet.
        </p>

        <div v-if="burnAddress" class="alert alert-warning" role="alert">
            Burn from this same wallet — connect it on moats.app. Only burns from this address
            count:
            <br />
            <code>{{ burnAddress }}</code>
        </div>

        <p class="buy_note">
            Need {{ thrSymbol }} to burn?
            <a href="#" @click.prevent="$emit('goToSwap')">Swap for it in this wallet</a>
            , or buy at
            <a
                href="https://lfj.gg/avalanche/trade/0xf56cecc07d97ac50630022cf84c19e612ae8c93d"
                target="_blank"
                rel="noopener noreferrer"
            >
                LFJ
            </a>
            or
            <a
                href="https://arenatrade.ai/token/0xf56cecc07d97ac50630022cf84c19e612ae8c93d"
                target="_blank"
                rel="noopener noreferrer"
            >
                ArenaTrade
            </a>
            . Always verify the {{ thrSymbol }} contract address:
            <code>{{ thrAddress || '0xf56CeCc07d97Ac50630022CF84C19e612ae8C93D' }}</code>
        </p>
    </div>
</template>

<script lang="ts">
import { defineComponent, computed } from 'vue'
import Big from 'big.js'

import { MOATS_BURN_URL } from '@/composables/useBaseAssetGate'

export default defineComponent({
    name: 'InsufficientBalanceNotice',
    props: {
        /** The requirement in whole tokens, as a plain decimal string, or '' when unknown. */
        thrValue: { type: String, default: '' },
        thrSymbol: { type: String, default: 'AVXTO' },
        thrAddress: { type: String, default: '' },
        /** Whole tokens this wallet has burned on Moats, or '' when not known. */
        burnedValue: { type: String, default: '' },
        /** The address whose burns count; omitted when there is no session. */
        burnAddress: { type: String, default: '' },
    },
    emits: ['goToSwap'],
    setup(props) {
        const formatWhole = (v: string) => {
            const n = Number(v)
            return Number.isFinite(n)
                ? n.toLocaleString('en-US', { maximumFractionDigits: 6 })
                : v
        }

        /** What is left to burn, formatted; '' when unknown or already met. */
        const remaining = computed(() => {
            if (!props.thrValue || props.burnedValue === '') return ''
            try {
                const left = Big(props.thrValue).minus(Big(props.burnedValue))
                return left.gt(0) ? formatWhole(left.toString()) : ''
            } catch {
                return ''
            }
        })

        return { formatWhole, remaining, moatsUrl: MOATS_BURN_URL }
    },
})
</script>

<style scoped lang="scss">
.insufficient_message {
    text-align: center;
    color: var(--primary-color, #e0e0e0);
    font-size: 15px;
    line-height: 1.7;

    p {
        margin: 0 0 12px !important;
    }

    a {
        color: var(--secondary-color, #e84142);
        text-decoration: underline;
    }

    code {
        word-break: break-all;
    }

    .alert {
        margin: 0 0 12px;
    }

    .buy_note {
        font-size: 13px;
        color: var(--primary-color-light, #aeb4b9);
    }
}
</style>
