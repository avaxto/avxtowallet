<template>
    <tr class="utxo_row">
        <td class="col_explorer">
            <a :href="explorerLink" v-if="explorerLink" target="_blank">
                <fa icon="globe"></fa>
            </a>
        </td>
        <td class="col_id">
            <p>{{ utxo.getUTXOID() }}</p>
        </td>
        <td>{{ typeName }}</td>
        <td class="col_locktime">{{ locktimeText }}</td>
        <td class="col_thresh">{{ out.getThreshold() }}</td>
        <td class="col_owners">
            <p v-for="addr in addresses" :key="addr">{{ addr }}</p>
        </td>
        <td class="col_bal">
            <div>
                <p>{{ balanceText }}</p>
                <p>{{ symbol }}</p>
            </div>
        </td>
    </tr>
</template>
<script lang="ts">
import { defineComponent, computed } from 'vue'
import { useStore } from 'vuex'
import { AmountOutput, AVMConstants, UTXO as AVMUTXO } from 'avalanche/dist/apis/avm'
import {
    PlatformVMConstants,
    StakeableLockOut,
    UTXO as PlatformUTXO,
} from 'avalanche/dist/apis/platformvm'
import { ava, bintools } from '@/AVA'
import AvaAsset from '@/js/AvaAsset'
import { bnToBig } from '@/helpers/helper'
import { UnixNow } from 'avalanche/dist/utils'
import { AvaNetwork } from '@/js/AvaNetwork'

export default defineComponent({
    name: 'UTXORow',
    props: {
        utxo: {
            type: Object as () => AVMUTXO | PlatformUTXO,
            required: true
        },
        isX: {
            type: Boolean,
            default: true
        }
    },
    setup(props) {
        const store = useStore()

        const out = computed(() => {
            return props.utxo.getOutput()
        })

        const typeID = computed((): number => {
            return out.value.getTypeID()
        })

        const addresses = computed((): string[] => {
            let addrs = out.value.getAddresses()

            let hrp = ava.getHRP()
            let id = props.isX ? 'X' : 'P'
            let addrsClean = addrs.map((addr) => {
                return bintools.addressToString(hrp, id, addr)
            })
            return addrsClean
        })

        const asset = computed(() => {
            let assetID = props.utxo.getAssetID()
            let idClean = bintools.cb58Encode(assetID)

            let asset =
                store.state.Assets.assetsDict[idClean] ||
                store.state.Assets.nftFamsDict[idClean]
            return asset
        })

        const explorerLink = computed(() => {
            let net: AvaNetwork = store.state.Network.selectedNetwork
            let explorer = net.explorerSiteUrl
            if (!explorer) return null
            return explorer + '/tx/' + bintools.cb58Encode(props.utxo.getTxID())
        })

        const locktime = computed(() => {
            let locktime = out.value.getLocktime().toNumber()
            if (!props.isX && typeID.value === PlatformVMConstants.STAKEABLELOCKOUTID) {
                let stakeableLocktime = (out.value as StakeableLockOut).getStakeableLocktime().toNumber()
                locktime = Math.max(locktime, stakeableLocktime)
            }
            return locktime
        })

        const locktimeText = computed(() => {
            let now = UnixNow().toNumber()
            let locktimeValue = locktime.value

            if (now >= locktimeValue) {
                return '-'
            } else {
                let date = new Date(locktimeValue * 1000)
                return date.toLocaleDateString() + ' ' + date.toLocaleTimeString()
            }
        })

        const symbol = computed(() => {
            if (!asset.value) return '-'
            return asset.value.symbol
        })

        const balanceText = computed(() => {
            if (!asset.value) return '-'

            if (typeID.value === 7 || typeID.value === PlatformVMConstants.STAKEABLELOCKOUTID) {
                let outputAmount = out.value as AmountOutput
                let denom = (asset.value as AvaAsset).denomination
                let bn = outputAmount.getAmount()
                return bnToBig(bn, denom).toLocaleString()
            }

            if ([6, 7, 10, 11].includes(typeID.value)) {
                return 1
            }

            return '-'
        })

        const typeName = computed((): string => {
            switch (typeID.value) {
                case AVMConstants.SECPMINTOUTPUTID:
                    return 'SECP Mint Output'
                case AVMConstants.SECPXFEROUTPUTID:
                    return 'SECP Transfer Output'
                case AVMConstants.NFTMINTOUTPUTID:
                    return 'NFT Mint Output'
                case AVMConstants.NFTXFEROUTPUTID:
                    return 'NFT Transfer Output'
                case PlatformVMConstants.STAKEABLELOCKOUTID:
                    return 'Stakeable Lock Output'
            }
            return ''
        })

        return {
            out,
            typeID,
            addresses,
            asset,
            explorerLink,
            locktime,
            locktimeText,
            symbol,
            balanceText,
            typeName
        }
    }
})
</script>
<style scoped lang="scss">
tr {
    font-size: 12px;
}

td {
    font-family: monospace;
    padding: 0;
}

.col_id {
    p {
        width: 80px;
        overflow: auto;
        text-overflow: ellipsis;
    }
}
.col_bal {
    > div {
        display: grid;
        grid-template-columns: 1fr 50px;
    }
}

.utxo_row {
    border-bottom: 1px solid var(--bg-light);

    &:hover {
        td {
            background-color: var(--bg-light);
        }
    }
}

.col_owners {
    //word-break: break-all;
    > p {
        text-overflow: ellipsis;
    }
}

.col_explorer {
    text-align: center;
    a {
        color: var(--primary-color-light);

        &:hover {
            color: var(--secondary-color);
        }
    }
}
</style>
