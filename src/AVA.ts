import { KeyChain as AVMKeyChain, AVMAPI } from '@/avalanche/apis/avm'
import { InfoAPI } from '@/avalanche/apis/info'
import Avalanche from '@/avalanche'
//@ts-ignore
import BinTools from '@/avalanche/utils/bintools'
import { EVMAPI } from '@/avalanche/apis/evm'

const ip: string = 'api.avax.network'
const port: number = 443
const defaultHrp = 'avax'
const protocol: string = 'https'
const network_id: number = 2
const chain_id: string = 'X'
const bintools: BinTools = BinTools.getInstance()
const ava: Avalanche = new Avalanche(ip, port, protocol, network_id, chain_id)

const avm: AVMAPI = ava.XChain()
const cChain: EVMAPI = ava.CChain()
const pChain = ava.PChain()
const infoApi: InfoAPI = ava.Info()
const keyChain: AVMKeyChain = avm.keyChain()

function isValidAddress(addr: string) {
    try {
        const res = bintools.stringToAddress(addr)
        return true
    } catch (err) {
        return false
    }
}

export { ava, avm, pChain, cChain, infoApi, bintools, isValidAddress, keyChain }
