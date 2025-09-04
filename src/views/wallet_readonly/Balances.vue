<template>
    <div>
        <label>Total</label>
        <p class="total">{{ totalBalance.toLocaleString() }}</p>
        <div class="cols" v-if="isReady">
            <div class="column">
                <h3>X-Chain</h3>
                <div class="bal_row">
                    <div>
                        <label>Available</label>
                        <p>{{ xUnlocked }}</p>
                    </div>
                    <div v-if="!balances.X.locked.isZero()">
                        <label>Locked</label>
                        <p>{{ xLocked }}</p>
                    </div>
                    <div v-if="!balances.X.multisig.isZero()">
                        <label>Multisig</label>
                        <p>{{ xMultisig }}</p>
                    </div>
                </div>
            </div>
            <div class="column">
                <h3>P-Chain</h3>
                <div class="bal_row">
                    <div>
                        <label>Available</label>
                        <p>{{ pUnlocked }}</p>
                    </div>
                    <div v-if="!balances.P.locked.isZero()">
                        <label>Locked</label>
                        <p>{{ pLocked }}</p>
                    </div>
                    <div v-if="!balances.P.lockedStakeable.isZero()">
                        <label>Locked Stakeable</label>
                        <p>{{ pLockedStake }}</p>
                    </div>
                    <div>
                        <label>Staking</label>
                        <p>{{ stake }}</p>
                    </div>
                    <div v-if="!balances.P.multisig.isZero()">
                        <label>Multisig</label>
                        <p>{{ pMultisig }}</p>
                    </div>
                </div>
            </div>
            <div class="column">
                <h3>C-Chain</h3>
                <label>Available</label>
                <p>{{ cUnlocked }}</p>
            </div>
        </div>
        <div v-else>Loading Balances..</div>
    </div>
</template>
<script lang="ts">
import { defineComponent, computed, type PropType } from 'vue'
import {
    bnToAvaxX,
    bnToAvaxP,
    bnToAvaxC,
    iAvaxBalance,
    BN,
    Big,
    bnToBigAvaxX,
    bnToBigAvaxC,
} from '@avalabs/avalanche-wallet-sdk'

export default defineComponent({
    name: 'Balances',
    props: {
        balances: {
            type: Object as PropType<iAvaxBalance>,
            required: true
        },
        stakeAmt: {
            type: Object as PropType<BN>,
            required: true
        }
    },
    setup(props) {
        const isReady = computed(() => {
            return props.balances && props.stakeAmt
        })

        const xUnlocked = computed(() => {
            return bnToAvaxX(props.balances.X.unlocked)
        })

        const xLocked = computed(() => {
            return bnToAvaxX(props.balances.X.locked)
        })

        const xMultisig = computed(() => {
            return bnToAvaxX(props.balances.X.multisig)
        })

        const pUnlocked = computed(() => {
            return bnToAvaxX(props.balances.P.unlocked)
        })

        const pLocked = computed(() => {
            return bnToAvaxX(props.balances.P.locked)
        })

        const pMultisig = computed(() => {
            return bnToAvaxX(props.balances.P.multisig)
        })

        const pLockedStake = computed(() => {
            return bnToAvaxX(props.balances.P.lockedStakeable)
        })

        const stake = computed(() => {
            return bnToAvaxP(props.stakeAmt)
        })

        const cUnlocked = computed(() => {
            return bnToAvaxC(props.balances.C)
        })

        const totalBalance = computed(() => {
            if (!props.balances || !props.stakeAmt) {
                return Big(0)
            }

            return bnToBigAvaxX(
                props.balances.X.unlocked
                    .add(props.balances.X.locked)
                    .add(props.balances.X.multisig)
                    .add(props.balances.P.unlocked)
                    .add(props.balances.P.locked)
                    .add(props.balances.P.lockedStakeable)
                    .add(props.balances.P.multisig.add(props.stakeAmt))
            ).add(bnToBigAvaxC(props.balances.C))
        })

        return {
            isReady,
            xUnlocked,
            xLocked,
            xMultisig,
            pUnlocked,
            pLocked,
            pMultisig,
            pLockedStake,
            stake,
            cUnlocked,
            totalBalance
        }
    }
})
</script>
<style scoped lang="scss">
label {
    font-size: 0.9em;
    color: var(--primary-color-light);
}

.total {
    font-size: 2em;
}

.cols {
    width: 100%;
    //display: grid;
    //grid-template-columns: 1fr 1fr 1fr;
    display: flex;
    justify-content: space-between;
    flex-flow: row wrap;
    h3 {
        font-weight: lighter;
        opacity: 0.6;
        font-size: 1.5em;
    }

    .column {
        display: flex;
        flex-direction: column;
        //margin-right: 2vw;
        //padding: 0 1em;
        padding-right: 1em;
        flex: 1 1 auto;

        &:first-of-type {
            padding-left: 0;
        }

        label {
            text-align: left;
        }
        p {
            text-align: left;
        }
    }

    .column + .column {
        padding-left: 1em;
        border-left: 1px solid var(--bg-light);
    }
}
</style>
