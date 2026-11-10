/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * The wallet's signers, found per chain across every connected platform
 * session — the bridge spans platforms, so the source may be the Bitcoin tab's
 * wallet while the destination is the EVM tab's. A signer is only returned
 * when it is on exactly the chain asked for.
 */
import { getPlatform } from '@/platforms'
import { activeEvmSigner } from '@/platforms/evmSigner'
import { useMainStore } from '@/stores'
import type { EvmSigner } from '@/evm/signer'
import { SolanaWallet } from '@/platforms/solana/wallet'
import { BitcoinWallet } from '@/platforms/bitcoin/wallet'
import type { BridgeChain, BridgeSigners } from './types'

/**
 * The signed-in Avalanche wallet's C-Chain address, or ''. While there is one,
 * it is the wallet's only EVM identity on the bridge: the one the portfolio
 * tab shows. A session the EVM tab holds for some other account (an extension,
 * an earlier phrase) must not slip in as the sender or the signer.
 */
function avalancheEvmAddress(): string {
    const avalanche = useMainStore().avalancheWallet as any
    const hex = avalanche?.getEvmAddress?.() ?? avalanche?.ethAddress
    return hex ? (String(hex).startsWith('0x') ? String(hex) : `0x${hex}`) : ''
}

function evmSigner(chain: BridgeChain): EvmSigner | null {
    // The active tab's signer first (the Avalanche tab's is its C-Chain), then
    // the EVM tab's even while another tab is in front — but only one for the
    // Avalanche wallet's own address when that wallet is signed in.
    const own = avalancheEvmAddress().toLowerCase()
    const candidates = [activeEvmSigner(), getPlatform('evm')?.getEvmSigner?.() ?? null]
    return (
        candidates.find(
            (s) => s && s.network.evmChainId === chain.evmChainId && (!own || s.address.toLowerCase() === own)
        ) ?? null
    )
}

function solanaWallet(chain: BridgeChain): SolanaWallet | null {
    const w = getPlatform('solana')?.getActiveWallet()
    return w instanceof SolanaWallet && w.network.id === chain.networkId ? w : null
}

function bitcoinWallet(chain: BridgeChain): BitcoinWallet | null {
    const w = getPlatform('bitcoin')?.getActiveWallet()
    return w instanceof BitcoinWallet && w.network.id === chain.networkId ? w : null
}

export const walletSigners: BridgeSigners = {
    evm: evmSigner,
    solana: solanaWallet,
    bitcoin: bitcoinWallet,
}

/** Whether some wallet can sign on `chain` right now. */
export function canSignOn(chain: BridgeChain): boolean {
    if (chain.kind === 'evm') return !!evmSigner(chain)
    if (chain.kind === 'solana') return !!solanaWallet(chain) && !solanaWallet(chain)!.isReadonly
    return !!bitcoinWallet(chain) && !bitcoinWallet(chain)!.isReadonly
}

/**
 * The wallet's own receiving address on `chain`, if a session has one — the
 * default recipient. An EVM address is the same on every EVM chain, so any
 * EVM session serves — the Avalanche wallet's C-Chain key first, the one the
 * portfolio shows, and the EVM tab's only when no Avalanche wallet is signed in.
 */
export function ownAddressOn(chain: BridgeChain): string {
    if (chain.kind === 'evm') {
        return avalancheEvmAddress() || getPlatform('evm')?.getActiveWallet()?.getPrimaryAddress() || ''
    }
    if (chain.kind === 'solana') {
        const w = getPlatform('solana')?.getActiveWallet()
        return w instanceof SolanaWallet && w.network.id === chain.networkId ? w.address : ''
    }
    const w = getPlatform('bitcoin')?.getActiveWallet()
    return w instanceof BitcoinWallet && w.network.id === chain.networkId ? w.getReceiveAddress() : ''
}
