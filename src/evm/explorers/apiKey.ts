/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * The user's Etherscan V2 API key.
 *
 * Etherscan V2 is a single multichain endpoint: one key covers every
 * etherscan-family network in the registry, so this is one setting rather than
 * one per chain. The app cannot ship a key (it would be shared by every user
 * and rate limited into uselessness immediately), so networks in that family
 * are simply skipped until a key is set — the rest of the portfolio still
 * works.
 */
const STORAGE_KEY = 'etherscan_api_key'

export function getEtherscanApiKey(): string | null {
    try {
        const key = localStorage.getItem(STORAGE_KEY)
        return key && key.trim() ? key.trim() : null
    } catch {
        return null
    }
}

export function setEtherscanApiKey(key: string | null): void {
    try {
        if (key && key.trim()) {
            localStorage.setItem(STORAGE_KEY, key.trim())
        } else {
            localStorage.removeItem(STORAGE_KEY)
        }
    } catch (e) {
        console.warn('[explorers/apiKey] Could not persist Etherscan API key:', e)
    }
}

export function hasEtherscanApiKey(): boolean {
    return getEtherscanApiKey() !== null
}
