<template>
    <div class="node_card">
        <p class="node_id">{{ node.nodeID }}</p>
        <!--        <div class="meta_row"></div>-->
        <div>
            <label>Fee</label>
            <p>{{ node.fee.toFixed(2) }}%</p>
        </div>
        <div>
            <label>Uptime</label>
            <!--            <p>{{ uptimeText }}</p>-->
            <p style="font-size: 0.8rem">
                Please refer to
                <a :href="vscoutURL" target="_blank">VScout</a>
                or
                <a :href="avascanURL" target="_blank">Avascan</a>
                to get more information about a node's uptime.
            </p>
        </div>
        <div>
            <label>Delegators</label>
            <p>{{ node.numDelegators }}</p>
        </div>
        <!--        <div class="stake_row">-->
        <!--            -->
        <!--        </div>-->
        <div>
            <label>Active Stake</label>
            <p>{{ totalStakeBig.toLocaleString(0) }} AVAX</p>
        </div>
        <div>
            <label>Available Stake</label>
            <p>{{ remainingStakeBig.toLocaleString(0) }} AVAX</p>
        </div>
        <!--        <div class="dates"></div>-->
        <div class="date_row">
            <label>Stake Start Date</label>
            <p>{{ node.startTime.toLocaleDateString() }}</p>
            <p>{{ node.startTime.toLocaleTimeString() }}</p>
        </div>
        <div class="date_row">
            <label>Stake End Date</label>
            <p>
                {{ node.endTime.toLocaleDateString() }}
            </p>
            <p>{{ node.endTime.toLocaleTimeString() }}</p>
        </div>
    </div>
</template>
<script lang="ts">
import { defineComponent, computed } from 'vue'
import { useNetworkStore } from '@/stores'
import { ValidatorListItem } from '@/types'
import { bnToBig } from '@/helpers/helper'
import { AvaNetwork } from '@/js/AvaNetwork'

export default defineComponent({
    name: 'NodeCard',
    props: {
        node: {
            type: Object as () => ValidatorListItem,
            required: true
        }
    },
    setup(props) {
        const networkStore = useNetworkStore()
        const uptimeText = computed((): string => {
            return (props.node.uptime * 100).toFixed(2) + '%'
        })

        const nodeStakeBig = computed(() => {
            return bnToBig(props.node.validatorStake, 9)
        })

        const delegatedStakeBig = computed(() => {
            return bnToBig(props.node.delegatedStake, 9)
        })

        const remainingStakeBig = computed(() => {
            return bnToBig(props.node.remainingStake, 9)
        })

        const totalStakeBig = computed(() => {
            return bnToBig(props.node.validatorStake.add(props.node.delegatedStake), 9)
        })

        const avascanURL = computed(() => {
            const activeNet: AvaNetwork = networkStore.selectedNetwork

            if (activeNet.networkId === 1) {
                return `https://avascan.info/staking/validator/${props.node.nodeID}`
            } else {
                return `https://testnet.avascan.info/staking/validator/${props.node.nodeID}`
            }
        })

        const vscoutURL = computed(() => {
            return `https://vscout.io/validator/${props.node.nodeID}`
        })

        return {
            uptimeText,
            nodeStakeBig,
            delegatedStakeBig,
            remainingStakeBig,
            totalStakeBig,
            avascanURL,
            vscoutURL
        }
    }
})
</script>
<style scoped lang="scss">
.node_card {
    //background-color: rgba(0, 0, 0, 0.02);
    background-color: var(--bg-light);
    border-radius: 4px;
    //width: max-content;
    box-shadow: 1px 2px 6px rgba(0, 0, 0, 0.2);

    > div {
        padding: 6px 14px;
        border-bottom: 1px solid var(--bg);
        &:last-of-type {
            border: none;
        }
    }
}

.node_id {
    word-break: break-all;
    //width: max-content;
    font-size: 13px;
    padding: 6px 14px;
    background-color: var(--bg-light);
    border-bottom: 2px solid var(--bg);
}

.meta_row {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    column-gap: 14px;
}
label {
    font-size: 13px;
}
p {
    font-size: 15px;
    color: var(--primary-color-light);
}

.dates {
    display: grid;
    grid-template-columns: 1fr 1fr;
    p {
        font-size: 13px;
    }
}

.stake_row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    column-gap: 8px;
}
.date_row {
    label {
        display: block;
    }
    p {
        display: inline-block;

        &:first-of-type {
            margin-right: 24px !important;
        }
    }
}
</style>
