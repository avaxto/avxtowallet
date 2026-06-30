/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/*
AVXTO - AVAX Toolbox Global Configuration File
*/

import BN from "bn.js"
export const X_CHAIN_POLLING_INTERVAL = 10000
export const C_CHAIN_POLLING_INTERVAL = 10000

// Global rate limit for all outgoing network requests (fixed-window strategy)
export const RATE_LIMIT_MAX_REQUESTS = 20  // max requests per window
export const RATE_LIMIT_WINDOW_MS = 1000   // window size in milliseconds
export const AVAX_TOOLBOX_VERSION = '0.0.47-beta'
export const AVXTO_CONTRACT_ADDRESS = '0xf56CeCc07d97Ac50630022CF84C19e612ae8C93D'
export const AVXTO_THR = new BN(1000000)
export const AVXTO_SYMBOL = 'AVXTO'
export const AVXTO_ICON = '/src/assets/AVXTO_Icon.png'
export const AVXTO_NAME = 'AVAX Toolbox'
export const TESTNET_AVXTO_CONTRACT_ADDRESS = '0xCf568B85904790A03FB2d17DD5042e99AB8F80F8'
export const TESTNET_AVXTO_THR = new BN(1000000)
export const TESTNET_AVXTO_SYMBOL = 'SMTK'
export const TESTNET_AVXTO_ICON = '/src/assets/AVXTO_Icon.png'
export const TESTNET_AVXTO_NAME = 'SomeToken'



