/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
import { createPinia } from 'pinia'

/**
 * The Pinia instance, in its own module so low-level code can obtain it
 * without importing the `@/stores` barrel.
 *
 * Non-component code has to pass the instance explicitly (see the
 * `useXStore(pinia)` calls in HdHelper and Erc20Token). Importing that from
 * the barrel would drag in every store — and through them the whole wallet and
 * SDK graph — which is both unnecessary coupling for a leaf module and enough
 * to break unit tests that only need one small store.
 */
export const pinia = createPinia()
