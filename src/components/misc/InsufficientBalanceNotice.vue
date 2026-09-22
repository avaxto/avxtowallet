<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<!--
  "You don't hold enough of the base asset, here is how to get some."

  Extracted out of views/InsufficientBalance.vue so the same text can appear
  in two places without the two drifting apart: that full page (still reached
  by its own route, and from the AVXTO menu while logged out) and the modal
  that now gates individual actions inside the wallet — see
  components/modals/BaseAssetGateModal.vue and composables/useBaseAssetGate.

  Every value is a prop rather than read from a store here, because the two
  callers learn them differently: the page recovers them from sessionStorage,
  the modal reads them live off the assets store. `cChainAddress` is optional
  for the same reason — the page can be opened with no session at all, and
  the deposit-address blocks hide themselves when there is nothing to show.
-->
<template>
    <p class="insufficient_message">
        The
        <a
            href="https://dexscreener.com/avalanche/0x2bdebde7e1088e42aafef104b5f7457aca5ab86f"
            target="_blank"
            rel="noopener noreferrer"
        >
            {{ thrSymbol }}
        </a>
        balance on this account is below the required minimum threshold to use this Premium feature
        <template v-if="thrValue">
            <br />
            <br />
            Minimum required:
            <strong>{{ thrValueFormatted }} {{ thrSymbol }}</strong>
        </template>
        <br />
        Please deposit
        <strong>{{ thrSymbol }}</strong>
        tokens to continue.
        <template v-if="cChainAddress">
            <br />
            <br />
            <div class="alert alert-warning" role="alert">
                <a href="#" @click.prevent="$emit('goToSwap')"><b>Click here</b></a>
                to make a deposit to your Avalanche C-Chain deposit address to continue:
                <br />
                <code>{{ cChainAddress }}</code>
            </div>
        </template>

        You can also swap
        <strong>{{ thrSymbol }}</strong>
        at
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
        .
        <br />
        (
        <em>
            Or any other DEX with
            <strong>{{ thrSymbol }}</strong>
            support.
        </em>
        )
        <template v-if="cChainAddress">
            <br />
            <br />
            <div class="alert alert-warning" role="alert">
                Double check your C-Chain deposit address:
                <br />
                <code>{{ cChainAddress }}</code>
            </div>
        </template>

        Always verify the
        <strong>{{ thrSymbol }}</strong>
        CA - Contract Address before making a purchase :
        <code>{{ thrAddress || '0xf56CeCc07d97Ac50630022CF84C19e612ae8C93D' }}</code>
        (Do NOT deposit to the contract address.)
    </p>
</template>

<script lang="ts">
import { defineComponent, computed } from 'vue'

export default defineComponent({
    name: 'InsufficientBalanceNotice',
    props: {
        /** The threshold as a plain digit string, or '' when unknown. */
        thrValue: { type: String, default: '' },
        thrSymbol: { type: String, default: 'AVXTO' },
        thrAddress: { type: String, default: '' },
        /** Omitted when there is no session to take a deposit address from. */
        cChainAddress: { type: String, default: '' },
    },
    emits: ['goToSwap'],
    setup(props) {
        // The threshold arrives as a plain digit string (BN#toString, e.g.
        // "1000000") — comma-group it the way balances elsewhere are
        // formatted (utils/big-extensions.ts).
        const thrValueFormatted = computed(() => {
            const n = Number(props.thrValue)
            return Number.isFinite(n) ? n.toLocaleString('en-US') : props.thrValue
        })

        return { thrValueFormatted }
    },
})
</script>

<style scoped lang="scss">
.insufficient_message {
    text-align: center;
    color: var(--primary-color, #e0e0e0);
    font-size: 15px;
    line-height: 1.7;
    margin: 0;

    a {
        color: var(--secondary-color, #e84142);
        text-decoration: underline;
    }

    code {
        word-break: break-all;
    }
}
</style>
