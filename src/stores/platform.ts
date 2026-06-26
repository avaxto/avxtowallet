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

export const usePlatformStore = defineStore('platform', () => {
    // Mainnet defaults (2000 AVAX validator, 25 AVAX delegator)
    const minStake = ref<BN>(ONEAVAX.mul(new BN(2000)))
    const minStakeDelegation = ref<BN>(ONEAVAX.mul(new BN(25)))
    const validatorListEarn = ref<ValidatorListItem[]>([])
    const isFetchingValidators = ref(false)
    const currentSupply = ref<BN>(new BN(0))

    const updateMinStakeAmount = async () => {
        try {
            const res = await pChain.getMinStake()
            if (res.minValidatorStake) minStake.value = res.minValidatorStake
            if (res.minDelegatorStake) minStakeDelegation.value = res.minDelegatorStake
        } catch (e) {
            console.warn('Could not fetch min stake amounts:', e)
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