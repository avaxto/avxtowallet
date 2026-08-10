/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { BN } from '@/avalanche'
import { ava, pChain } from '@/AVA'
import { ONEAVAX } from '@/avalanche/utils'
import { ValidatorListItem } from '@/types'
import { Avalanche as ChainKitAvalanche } from '@avalanche-sdk/chainkit'
import { isMainnetNetworkID, isTestnetNetworkID } from '@/utils/network-utils'

// Protocol minimums, used as network-aware fallbacks: the initial value before
// the first live fetch resolves, and what we fall back to if that fetch ever
// fails. The authoritative values always come from pChain.getMinStake() in
// updateMinStakeAmount() below.
const MAINNET_MIN_VALIDATOR_STAKE = ONEAVAX.mul(new BN(2000))
const MAINNET_MIN_DELEGATOR_STAKE = ONEAVAX.mul(new BN(25))
const TESTNET_MIN_VALIDATOR_STAKE = ONEAVAX.mul(new BN(1))
const TESTNET_MIN_DELEGATOR_STAKE = ONEAVAX.mul(new BN(1))

function minStakeDefaultsForNetwork(netID: number): { validator: BN; delegator: BN } {
    return isTestnetNetworkID(netID)
        ? { validator: TESTNET_MIN_VALIDATOR_STAKE, delegator: TESTNET_MIN_DELEGATOR_STAKE }
        : { validator: MAINNET_MIN_VALIDATOR_STAKE, delegator: MAINNET_MIN_DELEGATOR_STAKE }
}

export const usePlatformStore = defineStore('platform', () => {
    const initialMinStake = minStakeDefaultsForNetwork(ava.getNetworkID())
    const minStake = ref<BN>(initialMinStake.validator)
    const minStakeDelegation = ref<BN>(initialMinStake.delegator)
    const validatorListEarn = ref<ValidatorListItem[]>([])
    const isFetchingValidators = ref(false)
    const currentSupply = ref<BN>(new BN(0))

    const updateMinStakeAmount = async () => {
        const netID = ava.getNetworkID()
        const defaults = minStakeDefaultsForNetwork(netID)
        try {
            // Force a fresh node query. PlatformVMAPI.getMinStake() caches its
            // result on the api instance, and that instance (pChain) is reused
            // across network switches rather than recreated — so without
            // `refresh=true` this can silently return the PREVIOUS network's
            // cached minimums (e.g. mainnet's 25 AVAX delegator minimum still
            // showing right after switching to Fuji, whose real minimum is 1
            // AVAX).
            const res = await pChain.getMinStake(true)
            minStake.value = res.minValidatorStake ?? defaults.validator
            minStakeDelegation.value = res.minDelegatorStake ?? defaults.delegator
        } catch (e) {
            console.warn('Could not fetch min stake amounts:', e)
            // Fall back to the known-correct minimum for the CURRENT network
            // rather than leaving whatever (possibly wrong-network) value was
            // there before.
            minStake.value = defaults.validator
            minStakeDelegation.value = defaults.delegator
        }
    }

    const updateCurrentSupply = async () => {
        try {
            currentSupply.value = await pChain.getCurrentSupply()
        } catch (e) {
            console.warn('Could not fetch current supply:', e)
        }
    }

    const validatorMaxStake = (v: ValidatorListItem): BN => {
        return v.validatorStake.add(v.delegatedStake).add(v.remainingStake)
    }

    const fetchValidatorListEarn = async () => {
        if (isFetchingValidators.value) return
        const netID = ava.getNetworkID()
        if (!isMainnetNetworkID(netID) && !isTestnetNetworkID(netID)) {
            validatorListEarn.value = []
            return
        }
        const network = isMainnetNetworkID(netID) ? 'mainnet' : 'fuji'
        isFetchingValidators.value = true
        try {
            const chainkit = new ChainKitAvalanche({ network })
            const paginator = await chainkit.data.primaryNetwork.listValidators({
                validationStatus: 'active',
                subnetId: '11111111111111111111111111111111LpoYY',
                pageSize: 100,
            })
            const all: ValidatorListItem[] = []
            for await (const page of paginator) {
                for (const v of page.result.validators) {
                    if (v.validationStatus !== 'active') continue
                    all.push({
                        nodeID: v.nodeId,
                        validatorStake: new BN(v.amountStaked),
                        delegatedStake: new BN((v as any).amountDelegated ?? '0'),
                        remainingStake: new BN((v as any).delegationCapacity ?? '0'),
                        numDelegators: (v as any).delegatorCount ?? 0,
                        startTime: new Date(v.startTimestamp * 1000),
                        endTime: new Date(v.endTimestamp * 1000),
                        uptime: (v as any).uptimePerformance / 100,
                        fee: parseFloat((v as any).delegationFee ?? '0'),
                    })
                }
            }
            // Sort by highest uptime first
            all.sort((a, b) => b.uptime - a.uptime)
            validatorListEarn.value = all
        } catch (e) {
            console.warn('Could not fetch validator list:', e)
        } finally {
            isFetchingValidators.value = false
        }
    }

    return {
        minStake,
        minStakeDelegation,
        validatorListEarn,
        isFetchingValidators,
        currentSupply,
        updateMinStakeAmount,
        updateCurrentSupply,
        validatorMaxStake,
        fetchValidatorListEarn,
    }
})