<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<!--
  Restake AVAX: the wallet's past delegations, found on the indexer for every
  P-chain address it has used. Choosing one opens Quick Delegate with the same
  validator, amount, period, fee and reward address filled in, so a new
  delegation is one click away. See js/restake.ts.
-->
<template>
    <div class="restake_page">
        <div class="head">
            <h1>Restake AVAX</h1>
            <p class="desc">
                Your previous delegations, from every P-Chain address this wallet has used. Pick one to
                delegate again to the same validator with the same amount, period and reward address.
            </p>
        </div>

        <div v-if="loading" class="state">
            <Spinner class="spinner"></Spinner>
            Searching the indexer for your delegations…
        </div>
        <div v-else-if="err" class="error">{{ err }}</div>
        <div v-else-if="!delegations.length" class="state">
            No delegations found for this wallet's P-Chain addresses.
        </div>

        <div v-else class="list">
            <div v-for="d in delegations" :key="d.txHash" class="deleg">
                <div class="deleg_main">
                    <p class="node mono" :title="d.nodeID">{{ d.nodeID }}</p>
                    <p class="amount">{{ avax(d.amount) }} AVAX</p>
                </div>
                <div class="deleg_meta">
                    <span>{{ days(d) }} days</span>
                    <span>{{ date(d.start) }} – {{ date(d.end) }}</span>
                    <span v-if="d.end > now" class="tag running">running</span>
                    <span v-else class="tag">ended</span>
                    <span v-if="validatorOf(d)" class="tag">fee {{ validatorOf(d)?.fee }}%</span>
                    <span v-else-if="validatorsLoaded" class="tag bad">validator inactive</span>
                </div>
                <p class="reward">
                    Rewards to
                    <span class="mono" :title="d.rewardAddress">{{ short(d.rewardAddress) || 'this wallet' }}</span>
                    <span v-if="d.rewardAddress && !d.rewardAddressIsOwn" class="tag warn">not this wallet</span>
                </p>
                <v-btn
                    class="button_primary restake_btn"
                    depressed
                    small
                    :disabled="isBlocked || (validatorsLoaded && !validatorOf(d))"
                    @click="gatedAction(() => choose(d))"
                >
                    Restake
                </v-btn>
            </div>
            <p class="scan_note">
                Searched the {{ scanLimit.toLocaleString() }} most recent P-Chain transactions of this wallet.
            </p>
        </div>
    </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'

import { useMainStore, usePlatformStore } from '@/stores'
import { BN } from '@/avalanche'
import type { ValidatorListItem } from '@/types'
import { setRestakeSelection, type PastDelegation } from '@/js/restake'
import { listDelegationsForAddresses, DELEGATION_SCAN_LIMIT } from '@/js/Glacier/listDelegationsForAddresses'
import { useBaseAssetGate } from '@/composables/useBaseAssetGate'
import Spinner from '@/components/misc/Spinner.vue'

export default defineComponent({
    name: 'Restake',
    components: { Spinner },
    setup() {
        // Choosing a delegation stands in for Quick Delegate's "Find
        // Validator", so it carries the same AVXTO requirement.
        const { isBlocked, gatedAction } = useBaseAssetGate()
        const mainStore = useMainStore()
        const platformStore = usePlatformStore()
        const router = useRouter()

        const delegations = ref<PastDelegation[]>([])
        const loading = ref(false)
        const err = ref('')
        const now = Date.now()

        const validatorsLoaded = computed(
            () => !platformStore.isFetchingValidators && platformStore.validatorListEarn.length > 0
        )
        const validatorsByNode = computed(
            () => new Map<string, ValidatorListItem>(platformStore.validatorListEarn.map((v) => [v.nodeID, v]))
        )
        const validatorOf = (d: PastDelegation) => validatorsByNode.value.get(d.nodeID) ?? null

        const load = async () => {
            const wallet = mainStore.activeWallet
            if (!wallet) {
                err.value = 'Connect an Avalanche wallet to find its delegations.'
                return
            }
            loading.value = true
            err.value = ''
            try {
                delegations.value = await listDelegationsForAddresses(wallet.getAllAddressesP())
            } catch (e) {
                console.warn('[Restake] delegation lookup failed:', e)
                err.value = 'Could not reach the indexer. Try again in a moment.'
            } finally {
                loading.value = false
            }
        }

        const choose = (d: PastDelegation) => {
            setRestakeSelection(d)
            router.push('/wallet/quickdelegate')
        }

        const avax = (n: BN) =>
            (Number(n.toString()) / 1e9).toLocaleString(undefined, { maximumFractionDigits: 4 })
        const days = (d: PastDelegation) => Math.round((d.end - d.start) / 86_400_000)
        const date = (ms: number) =>
            new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
        const short = (a: string) => (a.length > 20 ? `${a.slice(0, 12)}…${a.slice(-6)}` : a)

        onMounted(() => {
            load()
            platformStore.fetchValidatorListEarn()
        })

        return {
            isBlocked,
            gatedAction,
            delegations,
            loading,
            err,
            now,
            validatorsLoaded,
            validatorOf,
            choose,
            avax,
            days,
            date,
            short,
            scanLimit: DELEGATION_SCAN_LIMIT,
        }
    },
})
</script>

<style scoped lang="scss">
.restake_page {
    max-width: 640px;
    margin: 0 auto;
}

h1 {
    font-weight: normal;
}

.head {
    margin-bottom: 24px;
    text-align: center;
}

.desc {
    color: var(--primary-color-light);
    font-size: 0.9em;
    margin-top: 4px;
}

.state {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    color: var(--primary-color-light);
    padding: 24px 0;

    .spinner {
        width: 18px !important;
        height: 18px !important;
    }
}

.error {
    color: var(--secondary-color);
    background-color: var(--bg-light);
    padding: 10px 16px;
    border-radius: 6px;
    font-size: 0.85em;
}

.deleg {
    display: grid;
    grid-template-columns: 1fr auto;
    grid-template-areas:
        'main btn'
        'meta btn'
        'reward btn';
    column-gap: 16px;
    row-gap: 4px;
    align-items: center;
    background-color: var(--bg-light);
    border-radius: 6px;
    padding: 12px 16px;
    margin-bottom: 10px;
}

.deleg_main {
    grid-area: main;
    display: flex;
    justify-content: space-between;
    gap: 12px;
    min-width: 0;

    .node {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .amount {
        font-weight: bold;
        white-space: nowrap;
    }
}

.deleg_meta {
    grid-area: meta;
    display: flex;
    flex-wrap: wrap;
    gap: 6px 12px;
    font-size: 12px;
    color: var(--primary-color-light);
}

.reward {
    grid-area: reward;
    font-size: 12px;
    color: var(--primary-color-light);
}

.restake_btn {
    grid-area: btn;
}

.tag {
    border: 1px solid var(--primary-color-light);
    border-radius: 3px;
    padding: 0 5px;
    font-size: 11px;

    &.running {
        border-color: var(--secondary-color);
        color: var(--secondary-color);
    }

    &.bad,
    &.warn {
        border-color: var(--error);
        color: var(--error);
    }
}

.mono {
    font-family: monospace;
}

.scan_note {
    font-size: 11px;
    color: var(--primary-color-light);
    text-align: center;
    margin-top: 12px;
}

@media (max-width: 600px) {
    .deleg {
        grid-template-columns: 1fr;
        grid-template-areas:
            'main'
            'meta'
            'reward'
            'btn';
    }
}
</style>
