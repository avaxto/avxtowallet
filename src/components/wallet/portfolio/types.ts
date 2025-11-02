import { UTXO } from '@/avalanche/apis/avm'

export interface NftGroupDict {
    [key: string]: [UTXO]
}
