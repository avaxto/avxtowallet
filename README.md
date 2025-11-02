# AVXTO Wallet

AVXTO - AVAX Toolbox Wallet was originally a fork of the original frontend Avalanche Vue application for Avalanche $AVAX


# This Wallet is Part of AVAX Toolbox Project

Telegram tech support gated by [$AVXTO Token](https://dexscreener.com/avalanche/0x2bdebde7e1088e42aafef104b5f7457aca5ab86f)!!

We build free OSS software for Avalanche enthusiasts, supported by the $AVXTO token

[Follow us on Twitter!](https://twitter.com/avaxto)

Join our Telegram group at: [AVAX.to](https://avax.to/telegram)

## Prerequisites

-   Yarn (https://classic.yarnpkg.com/en/docs/install/)
-   Recent version of npm (built on 10.9.0)
-   Node v16 or higher. Tested on node v22

## Installation

1. Clone the repo `git clone https://github.com/ava-labs/avalanche-wallet.git`
2. Go to root of the project `cd avalanche-wallet`
3. Install javascript dependencies with `yarn install`.

## Running The Project

In order for the wallet to work, it needs the Avalanche network to operate on. By default the wallet will connect to the Avalanche mainnet.

1. If you want to connect to a local network, make sure you have installed and able to run a AvlaancheGo node properly.
2. Run the project with hot reloading `yarn serve`

When you go to the website on your browser, you might get a warning saying
"Site is not secure". This is because we are signing our own SSL Certificates. Please ignore and continue to the website.

## Deployment

1.  Compile and minify to have a production ready application with `yarn build`.
2.  Serve from the `/dist` directory.

## Changing the Network

By default the wallet will connect to the Avalanche tmainnet. You can change to another network by clicking the button labeled `TestNet` on the navigation bar and selecting another network, or add a custom network.

## Explorer API

A valid explorer API is required to correctly display balances for Mnemonic and Ledger type wallets.
The wallet uses the Avalanche Explorer API to display wallet transaction history.

WARNING: This history might be out of order and incomplete.

## Browser Support

We suggest using Google Chrome to view the Avalanche Wallet website.

### Firefox and https

Firefox does not allow https requests to localhost. But the Avalanche Wallet uses https by default, so we will need to change this to http. Make this switch by editing the `vue.config.js` file in the root directory and change

```
devServer: {
    https: true
},
```

to

```
devServer: {
    https: false
},
```

and run `yarn serve` to reflect the change.

# Accounts

The wallet can encrypt your private keys into a secure file encrypted by a password.

```json
{
    "accounts": iUserAccountEncrypted[]
}
```

# Language Setting

Saved into local storage as a 2 letter code.

```
"lang": "en"
```

# Dependencies

##### Avalanche Node (https://github.com/ava-labs/avalanchego)

To get utxos and to send transactions.

#### Explorer API Node (https://github.com/ava-labs/ortelius)

To check if an address was used before, and to get activity history.

# Default Connections

The wallet needs to connect to an Avalanche node, and an explorer node to operate properly.

By default, there are two network options to connect to: `Mainnet` and `Fuji`.

##### Mainnet

-   Avalanche API: `https://api.avax.network:443`
-   Explorer API: `https://explorerapi.avax.network`

##### Fuji (Testnet)

-   Avalanche API: `https://api.avax-test.network:443`
-   Explorer API: `https://explorerapi.avax-test.network`


# Legal Notices

Avalanche and AVAX are registered trademarks of Ava Labs Inc.

*This is not an official Ava Labs project. We are in no way affiliated with Ava Labs.*

## Originally Embedded Code

This repository contains the following (modified) code originally developed by Ava Labs:

* [avalanche-wallet - BSD 3 Clause License](https://github.com/ava-labs/avalanche-wallet?tab=BSD-3-Clause-1-ov-file#readme)

* [v3.x.x-legacy avalanchejs library - using BSD 3 Clause License](https://github.com/ava-labs/avalanchejs/blob/v3.x.x-legacy/LICENSE)

* [avalanche-wallet-sdk using BSD 3 Clause License](https://github.com/ava-labs/avalanche-wallet-sdk/blob/dev/LICENSE)

* [vue-components - BSD 3 Clause License](https://github.com/ava-labs/vue-components?tab=BSD-3-Clause-1-ov-file#readme)


## Disclaimer of Liability

This free open source software provided for Avalanche AVAX learning and exploration purposes. No warranty is offered, express or implied, as to the suitability or correctness of this code. **Cryptocurrency transactions are irreversible.** We are not responsible for losses incurred during the use of this software. For safety, please test [using a test network](https://docs.avax.network/quickstart/create-a-local-test-network) before deploying.
