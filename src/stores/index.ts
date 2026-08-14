/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
// Pinia itself lives in its own module so leaf code can import it without
// pulling in every store through this barrel.
export { pinia } from './pinia'

// Export all stores for direct Pinia usage
export { useMainStore } from './main'
export { useAssetsStore } from './assets'
export { useNetworkStore } from './network'
export { useNotificationsStore } from './notifications'
export { useHistoryStore } from './history'
export { usePlatformStore } from './platform'
export { useLedgerStore } from './ledger'
export { useAccountsStore } from './accounts'
export { useEarnStore } from './earn'
export { useErc721Store } from './erc721'
export { useAvxtoStore } from './avxto'
export { useCChainSdkAssetsStore } from './cChainSdkAssets'
export type { CChainSdkAsset } from './cChainSdkAssets'
export { useStatusBarStore } from './statusbar'
export type { StatusBarType } from './statusbar'
export { useSessionLogStore } from './sessionlog'
export type { LogEntry, LogDotColor } from './sessionlog'
export { useThrModalStore } from './thrModal'
export { useOfflineSigningStore, isOfflineTxId, OFFLINE_TX_ID } from './offlineSigning'
export type { SignedTxRecord, SignedTxFamily } from './offlineSigning'
export { useTransferPrefillStore } from './transferPrefill'
export type { TransferPrefillParams } from './transferPrefill'