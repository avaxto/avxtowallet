/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Whether an extension's `accountsChanged` announcement names the account the
 * wallet already has. Core re-announces the same account on unlock and on
 * chain switches; treating that as a switch tears the session down and
 * rebuilds it for nothing, blanking its platform tab meanwhile.
 *
 * Compares case- and `0x`-insensitively: `InjectedWallet.ethAddress` is stored
 * lowercased without the prefix, while extensions announce EIP-55 with it.
 */
export function isSameInjectedAccount(currentEthAddress: string | null | undefined, announced: string): boolean {
    if (!currentEthAddress || !announced) return false
    const norm = (a: string) => a.trim().toLowerCase().replace(/^0x/, '')
    return norm(currentEthAddress) === norm(announced)
}
