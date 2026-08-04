import { Tx as AVMTx } from '@/avalanche/apis/avm/tx'
import { xChain } from '@/avalanche-wallet-sdk'
import { bintools, cChain, pChain } from '@/AVA'
import { Tx as PlatformTx } from '@/avalanche/apis/platformvm/tx'
import { Tx as EVMTx } from '@/avalanche/apis/evm/tx'
import { Buffer as BufferAvalanche } from '@/avalanche'
import { ChainIdType } from '@/constants'
import { pinia } from '@/stores/pinia'
import { useOfflineSigningStore } from '@/stores/offlineSigning'

/**
 * Every Avalanche-native broadcast in the app funnels through these three
 * helpers, which makes them the single place to honour offline signing —
 * see stores/offlineSigning.ts.
 *
 * /wallet/broadcast deliberately calls avm|pChain|cChain.issueTx directly
 * rather than going through here, so submitting a saved transaction is never
 * itself intercepted.
 */
function captureIfOffline(
    tx: AVMTx | PlatformTx | EVMTx,
    chain: ChainIdType,
    label: string
): string | null {
    const offline = useOfflineSigningStore(pinia)
    if (!offline.isActive) return null

    return offline.capture({
        label,
        family: 'avalanche',
        chain,
        // Raw signed bytes, no checksum: issueTx appends its own when
        // submitting, and /wallet/broadcast does the same on the way back in.
        base64: BufferAvalanche.from(tx.toBuffer()).toString('base64'),
    })
}

export async function issueX(tx: AVMTx, label = 'X-Chain transaction') {
    const captured = captureIfOffline(tx, 'X', label)
    if (captured) return captured
    return xChain.issueTx('0x' + bintools.addChecksum(tx.toBuffer()).toString('hex'))
}

export async function issueP(tx: PlatformTx, label = 'P-Chain transaction') {
    const captured = captureIfOffline(tx, 'P', label)
    if (captured) return captured
    return pChain.issueTx('0x' + bintools.addChecksum(tx.toBuffer()).toString('hex'))
}

export async function issueC(tx: EVMTx, label = 'C-Chain atomic transaction') {
    const captured = captureIfOffline(tx, 'C', label)
    if (captured) return captured
    return cChain.issueTx('0x' + bintools.addChecksum(tx.toBuffer()).toString('hex'))
}
