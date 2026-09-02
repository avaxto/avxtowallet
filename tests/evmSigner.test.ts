/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * The EVM signing interface, and the two features written against it.
 *
 * What is worth testing here is not that a mock got called — it is the
 * properties that made the launcher and the swap Avalanche-only in the first
 * place, and that would silently come back:
 *
 *   - every read and every send lands on the signer's chain, not a singleton's;
 *   - a contract creation omits `to` entirely rather than sending an empty one;
 *   - the aggregator is asked about the chain the wallet is actually on;
 *   - explorer links follow the network instead of defaulting to snowtrace.
 */
import Web3 from 'web3'

import { estimateGasWith, toHexWei } from '@/evm/signer'
import type { EvmSigner, EvmTxRequest } from '@/evm/signer'
import {
    explorerAddressUrl,
    explorerName,
    explorerTxUrl,
    getEvmNetworkByChainId,
    loadCustomEvmNetworks,
} from '@/evm/networkRegistry'
import type { EvmNetwork } from '@/evm/networkRegistry'
import { BN } from '@/avalanche'
import { encodeDeployData } from '@/js/TokenLauncher'
import { approveRouter, executeSwap, getAllowance, isNativeToken } from '@/js/ArenaSwap'
import { avalancheTokenRegistry } from '@/platforms/avalanche/tokenRegistry'
import { tokenRegistryFor } from '@/evm/tokenRegistry'
import type { PlatformTokenRegistry } from '@/platforms/types'

loadCustomEvmNetworks()

const AVALANCHE = getEvmNetworkByChainId(43114) as EvmNetwork
const ROBINHOOD = getEvmNetworkByChainId(4663) as EvmNetwork

const HOLDER = '0x4a0fee7e85f8d536bc55bf509f5fee3e5548c779'
const TOKEN = '0xb8d7710f7d8349a506b75dd184f05777c82dad0c'
const SPENDER = '0xa59ad32dad425250ca3601f964d92611818f86f7'

/**
 * A signer that records what it was asked to send instead of signing.
 *
 * Reads go through a real `Web3` with no provider attached — enough for ABI
 * encoding and contract objects, which is all these paths need — so the ERC-20
 * calldata under test is genuinely web3's, not a stand-in.
 */
class RecordingSigner implements EvmSigner {
    readonly network: EvmNetwork
    readonly address = HOLDER
    readonly authSubject = { type: 'injected' }

    sent: EvmTxRequest[] = []
    estimated: EvmTxRequest[] = []
    private readonly web3: Web3

    constructor(network: EvmNetwork) {
        this.network = network
        this.web3 = new Web3()
    }

    reader(): Web3 {
        return this.web3
    }

    async getGasPrice(): Promise<BN> {
        return new BN('25000000000')
    }

    async getNonce(): Promise<number> {
        return 7
    }

    async estimateGas(req: EvmTxRequest, fallbackGasLimit: number): Promise<number> {
        this.estimated.push(req)
        return fallbackGasLimit
    }

    async send(req: EvmTxRequest): Promise<string> {
        this.sent.push(req)
        return '0xdeadbeef'
    }

    async waitForReceipt(txHash: string) {
        return { txHash, contractAddress: null, status: true }
    }

    async assertOnChain(): Promise<void> {
        /* nothing to drift in a test double */
    }

    tokenRegistry(): PlatformTokenRegistry {
        // Mirrors what the real signers return for these two chains.
        return this.network.evmChainId === 43114
            ? avalancheTokenRegistry
            : tokenRegistryFor(this.network)
    }
}

describe('EvmSigner helpers', () => {
    it('encodes zero and undefined wei identically', () => {
        expect(toHexWei(undefined)).toBe('0x0')
        expect(toHexWei(new BN(0))).toBe('0x0')
        expect(toHexWei(new BN('22826019613667'))).toBe('0x14c298ca6be3')
    })

    it('falls back rather than throwing when the node refuses to estimate', async () => {
        const web3 = new Web3()
        // No provider attached, so estimateGas rejects — the same shape as a
        // node refusing a contract creation it cannot simulate.
        const gas = await estimateGasWith(web3, HOLDER, { data: '0x60' }, 6_000_000)
        expect(gas).toBe(6_000_000)
    })
})

describe('explorer URLs follow the network', () => {
    it('uses each network’s own explorer', () => {
        expect(explorerTxUrl(AVALANCHE, '0xabc')).toBe('https://snowtrace.io/tx/0xabc')
        expect(explorerTxUrl(ROBINHOOD, '0xabc')).toBe(
            'https://robinhoodchain.blockscout.com/tx/0xabc'
        )
        expect(explorerAddressUrl(ROBINHOOD, '0xdef')).toBe(
            'https://robinhoodchain.blockscout.com/address/0xdef'
        )
    })

    it('names the explorer from its host', () => {
        expect(explorerName(AVALANCHE)).toBe('snowtrace.io')
        expect(explorerName(ROBINHOOD)).toBe('robinhoodchain.blockscout.com')
    })

    it('returns empty rather than a broken link when a network has no explorer', () => {
        const bare = { ...ROBINHOOD, explorerUrl: undefined } as EvmNetwork
        expect(explorerTxUrl(bare, '0xabc')).toBe('')
    })
})

describe('token launcher is chain-neutral', () => {
    const params = {
        name: 'Test Token',
        symbol: 'TST',
        decimals: 18,
        initialSupply: '1000',
        maxSupply: '2000',
    }

    it('builds identical creation calldata whatever chain the signer is on', () => {
        const onAvalanche = encodeDeployData(new RecordingSigner(AVALANCHE).reader(), params)
        const onRobinhood = encodeDeployData(new RecordingSigner(ROBINHOOD).reader(), params)
        expect(onAvalanche).toBe(onRobinhood)
        expect(onAvalanche.startsWith('0x')).toBe(true)
    })

    it('rejects a supply above the cap', () => {
        const web3 = new Web3()
        expect(() =>
            encodeDeployData(web3, { ...params, initialSupply: '3000' })
        ).toThrow(/cannot exceed max supply/)
    })

    it('rejects a zero cap', () => {
        const web3 = new Web3()
        expect(() => encodeDeployData(web3, { ...params, maxSupply: '0' })).toThrow(
            /greater than zero/
        )
    })
})

describe('swap sends through the signer', () => {
    it('builds the allowance contract against the signer’s own web3', async () => {
        // Guards a real parse hazard: `new signer.reader().eth.Contract(...)`
        // binds `new` to `signer.reader`, so it constructs the *reader* and
        // dies with "is not a constructor" before any RPC is attempted. A
        // provider-less reader cannot complete the call either way, so the
        // assertion is on which failure comes back.
        const signer = new RecordingSigner(ROBINHOOD)
        let message = ''
        try {
            await getAllowance(signer, TOKEN, HOLDER, SPENDER)
        } catch (e: any) {
            message = e?.message ?? ''
        }
        expect(message).not.toMatch(/is not a constructor/)
    })

    it('encodes an approval and sends it to the token, not the router', async () => {
        const signer = new RecordingSigner(ROBINHOOD)
        await approveRouter(signer, TOKEN, SPENDER, new BN('123'), 4)

        expect(signer.sent).toHaveLength(1)
        const sent = signer.sent[0]
        expect(sent.to).toBe(TOKEN)
        // approve(address,uint256)
        expect(sent.data?.startsWith('0x095ea7b3')).toBe(true)
        expect(sent.data?.toLowerCase()).toContain(SPENDER.slice(2).toLowerCase())
        expect(sent.nonce).toBe(4)
    })

    it('sends the aggregator’s transaction verbatim, with its own gas figure', async () => {
        const signer = new RecordingSigner(ROBINHOOD)
        await executeSwap(
            signer,
            {
                fromAmount: '1',
                toAmount: '1',
                toAmountMin: '1',
                fromAmountUSD: 0,
                toAmountUSD: 0,
                priceImpact: null,
                approvalAddress: null,
                gasLimit: 500_000,
                transactionRequest: { to: SPENDER, data: '0xabcdef', value: '0x14c298ca6be3' },
            },
            9
        )

        expect(signer.sent).toHaveLength(1)
        const sent = signer.sent[0]
        expect(sent.to).toBe(SPENDER)
        expect(sent.data).toBe('0xabcdef')
        expect(sent.value?.toString()).toBe('22826019613667')
        // Padded by 20%, not re-estimated against a different state.
        expect(sent.gasLimit).toBe(600_000)
        expect(sent.nonce).toBe(9)
        // The swap never asks for an estimate when the quote carries one.
        expect(signer.estimated).toHaveLength(0)
    })

    /**
     * Pins a regression that was live for one commit of this refactor: deriving
     * the registry from the network alone (`tokenRegistryFor`) instead of from
     * the signer silently reduced Avalanche's 24-entry allowlist to a single
     * native entry, so an impostor claiming "USDC" would have resolved fine.
     */
    it('keeps Avalanche’s full pinned-contract allowlist behind the signer', () => {
        const avalanche = new RecordingSigner(AVALANCHE)
        const robinhood = new RecordingSigner(ROBINHOOD)

        expect(avalanche.tokenRegistry().getAll().length).toBeGreaterThan(20)

        // Symbols the registry pins, at an address that is not the registered
        // one. (USDT and AVXTO are chosen because they are actually in
        // registry.json with chainId 43114 — asserting on a symbol the registry
        // has never heard of would pass vacuously.)
        const impostor = '0x000000000000000000000000000000000000dead'
        expect(avalanche.tokenRegistry().isSpoofedToken('USDT', impostor, 43114)).toBe(true)
        expect(avalanche.tokenRegistry().isSpoofedToken('AVXTO', impostor, 43114)).toBe(true)

        // …and the real address for one of them is accepted.
        expect(
            avalanche
                .tokenRegistry()
                .isSpoofedToken('AVXTO', '0xf56CeCc07d97Ac50630022CF84C19e612ae8C93D', 43114)
        ).toBe(false)

        // A symbol no registry has an opinion on is not rejected.
        expect(avalanche.tokenRegistry().isSpoofedToken('NOTAREALTOKEN', impostor, 43114)).toBe(
            false
        )

        // Robinhood's registry pins its native asset and nothing else, so the
        // same "USDC" is not something it can call an impostor.
        expect(robinhood.tokenRegistry().isSpoofedToken('USDT', impostor, 4663)).toBe(false)
        expect(robinhood.tokenRegistry().isReservedNativeSymbol('ETH')).toBe(true)
    })

    /**
     * Regression for a real false positive: Avalanche has TWO separately
     * legitimate contracts trading under essentially the same ticker — the
     * old Avalanche-Bridge-wrapped USDT.e and the native USDt Tether issues
     * directly on the C-Chain. `isSpoofedToken` matches by symbol, so a
     * registry with only one of the two pinned addresses rejects the other
     * REAL contract as an impostor of it. Both must be recognized.
     */
    it('does not flag a second, separately legitimate contract for the same symbol', () => {
        const avalanche = new RecordingSigner(AVALANCHE)
        const registry = avalanche.tokenRegistry()

        const bridged = '0xde3A24028580884448a5397872046a019649b084'
        const native = '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7'

        expect(registry.isSpoofedToken('USDT', bridged, 43114)).toBe(false)
        // The contract's own `symbol()` reads "USDt" for the native token —
        // case-insensitive by design (see `normalizeSymbol`), so this must
        // resolve the same as the all-caps form above.
        expect(registry.isSpoofedToken('USDt', native, 43114)).toBe(false)

        // An address that is neither of the two real ones is still rejected.
        const impostor = '0x000000000000000000000000000000000000dead'
        expect(registry.isSpoofedToken('USDT', impostor, 43114)).toBe(true)
    })

    it('treats the zero address as native on every chain', () => {
        expect(isNativeToken('0x0000000000000000000000000000000000000000')).toBe(true)
        expect(isNativeToken(TOKEN)).toBe(false)
    })
})
