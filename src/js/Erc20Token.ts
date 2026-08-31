import { TokenListToken } from '@/types'
import { web3 } from '@/evm'
import { BN } from '@/avalanche'
import { bnToBig } from '@/helpers/helper'
import Big from 'big.js'
import { pinia, useAssetsStore } from '@/stores'

import ERC20Abi from '@openzeppelin/contracts/build/contracts/ERC20.json'

class Erc20Token {
    data: TokenListToken
    contract: any
    balanceRaw: string
    balanceBN: BN
    balanceBig: Big

    constructor(tokenData: TokenListToken) {
        this.data = tokenData
        this.balanceRaw = '0'
        this.balanceBN = new BN('0')
        this.balanceBig = Big(0)

        //@ts-ignore
        const tokenInst = new web3.eth.Contract(ERC20Abi.abi, tokenData.address)
        this.contract = tokenInst
    }

    /**
     * Forgets the balance, keeping the token itself.
     *
     * A token in the list is configuration — its address, symbol and decimals
     * belong to the chain, not to whoever is logged in — but the balance on it
     * belongs to one wallet. Session teardown therefore has to reach in here:
     * clearing the token list instead would throw away the user's custom
     * tokens, and clearing nothing would show the previous account's balances
     * to the next one until each happened to be refetched.
     */
    resetBalance() {
        this.balanceRaw = '0'
        this.balanceBN = new BN('0')
        this.balanceBig = Big(0)
    }

    // Returns a new instance of the token, given only the erc20 address
    static fromAddress(address: string) {
        //@ts-ignore
        const tokenInst = new web3.eth.Contract(ERC20Abi.abi, address)
    }

    createTransferTx(to: string, amount: BN) {
        return this.contract.methods.transfer(to, amount.toString())
    }

    async updateBalance(address: string) {
        const bal = await this.contract.methods.balanceOf('0x' + address).call()
        this.balanceRaw = bal
        this.balanceBN = new BN(bal)
        this.balanceBig = bnToBig(this.balanceBN, parseInt(this.data.decimals as string))

        const assetsStore = useAssetsStore(pinia)
        const baseAsset = assetsStore.baseAsset
        // The chain id is part of the identity check, not just the address.
        // This branch navigates the user out of the wallet entirely, and a
        // contract address is only unique *within* a chain — the same address
        // routinely exists on several EVM chains (deterministic deploys, or
        // simply the same deployer at the same nonce). Matching on the address
        // alone would eject someone from the wallet because an unrelated token
        // on another network happened to share AVXTO's address.
        if (
            baseAsset &&
            this.data.address.toLowerCase() === baseAsset.address.toLowerCase() &&
            this.data.chainId === baseAsset.chainId &&
            baseAsset.thr
        ) {
            if (this.balanceBN.lt(baseAsset.thr)) {
                const thrHuman = baseAsset.thr.toString()
                sessionStorage.setItem('insufficientBalance_thr', thrHuman)
                sessionStorage.setItem('insufficientBalance_symbol', baseAsset.symbol)
                sessionStorage.setItem('insufficientBalance_address', baseAsset.address)
                sessionStorage.setItem('insufficientBalance_cChainAddress', '0x' + address)
                window.location.href = '/insufficient-balance'
            }
        }
    }
}

export default Erc20Token
