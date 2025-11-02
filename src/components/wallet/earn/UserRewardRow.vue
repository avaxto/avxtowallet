<template>
    <div class="reward_row">
        <div class="top_bar">
            <div style="display: flex; justify-content: space-between">
                <p>{{ startDate.toLocaleString() }}</p>
                <p>{{ endDate.toLocaleString() }}</p>
            </div>
            <div
                class="reward_bar"
                :style="{
                    width: `${percFull * 100}%`,
                }"
            ></div>
        </div>
        <div class="data_row stake_info">
            <div>
                <label>NodeID</label>
                <p class="reward node_id">{{ tx.nodeId }}</p>
            </div>
            <div>
                <label>{{ $t('earn.rewards.row.stake') }}</label>
                <p class="reward">{{ stakeBig.toLocaleString() }} AVAX</p>
            </div>
            <div style="text-align: right">
                <label>{{ $t('earn.rewards.row.reward') }}</label>
                <p class="reward">{{ rewardBig.toLocaleString() }} AVAX</p>
            </div>
        </div>
    </div>
</template>
<script lang="ts">
import 'reflect-metadata'
import { defineComponent, ref, computed, onMounted, onUnmounted } from 'vue'
import { BN } from '@/avalanche'
import Big from 'big.js'
import { bnToBigAvaxP } from '@/avalanche-wallet-sdk'
import { PChainTransaction } from '@avalabs/glacier-sdk'

interface Props {
    tx: PChainTransaction
}

export default defineComponent({
    name: 'UserRewardRow',
    props: {
        tx: {
            type: Object as () => PChainTransaction,
            required: true
        }
    },
    setup(props: Props) {
        const now = ref(Date.now())
        let intervalID: any = null

        const updateNow = () => {
            now.value = Date.now()
        }

        const startTime = computed(() => {
            return (props.tx.startTimestamp ?? 0) * 1000
        })

        const endtime = computed(() => {
            return (props.tx.endTimestamp ?? 0) * 1000
        })

        const startDate = computed(() => {
            return new Date(startTime.value)
        })

        const endDate = computed(() => {
            return new Date(endtime.value)
        })

        const rewardAmt = computed((): BN => {
            return new BN(props.tx.estimatedReward || 0)
        })

        const stakingAmt = computed((): BN => {
            if (props.tx.amountStaked !== undefined) {
                return new BN(props.tx.amountStaked[0].amount || 0)
            }
            return new BN(0)
        })

        const rewardBig = computed((): Big => {
            return Big(rewardAmt.value.toString()).div(Math.pow(10, 9))
        })

        const stakeBig = computed(() => {
            return bnToBigAvaxP(stakingAmt.value)
        })

        const percFull = computed((): number => {
            const range = endtime.value - startTime.value
            const res = (now.value - startTime.value) / range
            return Math.min(res, 1)
        })

        onMounted(() => {
            intervalID = setInterval(() => {
                updateNow()
            }, 2000)
        })

        onUnmounted(() => {
            clearInterval(intervalID)
        })

        return {
            now,
            startTime,
            endtime,
            startDate,
            endDate,
            rewardAmt,
            stakingAmt,
            rewardBig,
            stakeBig,
            percFull
        }
    }
})
</script>
<style scoped lang="scss">
@use '../../../main';

.node_id {
    word-break: break-all;
}

.top_bar {
    height: max-content;
    position: relative;
    padding: 2px 8px;
    border-bottom: 2px solid var(--bg-wallet-light);
}
.reward_row {
    border-radius: 4px;
    overflow: hidden;
    font-size: 14px;
    //border: 2px solid var(--bg-light);
    background-color: var(--bg-light);
}

.data_row {
    grid-column: 1/3;
    display: grid;
    grid-template-columns: 1fr 280px;
    align-items: center;
}

.date {
    z-index: 1;
}
.reward_bar {
    background-color: var(--success);
    position: absolute;
    opacity: 0.5;
    height: 100%;
    left: 0;
    top: 0;
    z-index: 0;
}

.stake_info {
    padding: 6px 12px;
    display: grid;
    column-gap: 14px;
    grid-template-columns: 2fr 1fr 1fr;
    /*justify-content: space-between;*/
    /*text-align: right;*/
    text-align: left;

    > div {
        align-self: baseline;
    }
}

label {
    color: var(--primary-color-light) !important;
}

@include main.mobile-device {
    .stake_info {
        grid-column: 1/3;
        border-left: none;
        border-top: 3px solid var(--bg);

        > div:first-of-type {
            text-align: left;
        }
    }
}
</style>
