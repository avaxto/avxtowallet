import { TokenListToken } from '@/types'
import { web3 } from '@/evm'
import { BN } from '@/avalanche'
import { bnToBig } from '@/helpers/helper'
import Big from 'big.js'

import ERC20Abi from '@openzeppelin/contracts/build/contracts/ERC20.json'

class Erc20Token {
    data: TokenListToken
    contract: any
    balanceRaw: string
    balanceBN: BN
    balanceBig: Big
    /**
     * Whether `updateBalance` has ever completed for this token.
     *
     * A zero balance and a not-yet-fetched balance are indistinguishable by
     * value alone, and the base-asset gate (see composables/useBaseAssetGate)
     * has to tell them apart: treating "not loaded yet" as "holds nothing"
     * would lock every gated action for the first seconds of a session, for
     * everyone, including holders.
     */
    balanceFetched: boolean

    constructor(tokenData: TokenListToken) {
        this.data = tokenData
        this.balanceRaw = '0'
        this.balanceBN = new BN('0')
        this.balanceBig = Big(0)
        this.balanceFetched = false

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
        // Back to "unknown", not "known to be zero": the next session's
        // balance has not been read yet, and the gate must not treat the
        // outgoing wallet's cleared figure as the incoming one's answer.
        this.balanceFetched = false
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
        this.balanceFetched = true
    }
}

export default Erc20Token
