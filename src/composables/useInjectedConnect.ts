/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * "Connect Wallet via extension, then go to X" — the logic behind the
 * Navbar's own Connect Wallet button and the AVXTO menu's "Swap AVXTO" link,
 * pulled out once both needed it rather than copy-pasted a second time (a
 * third copy already exists in views/access/Menu.vue's `runAction`, kept
 * separate — that one drives a whole screen's worth of UI: a per-platform
 * results box, a named "Connecting X…" state on its own buttons. Neither
 * caller here needs that; both just want a toast and a destination).
 *
 * Sweeps every platform the installed extension can open in one pass, the
 * same way Menu.vue's own connect button does — one extension is usually
 * credentials for several platforms at once (Core: Bitcoin/EVM/Solana;
 * MetaMask: EVM alongside Avalanche's own C-Chain).
 */
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useActivePlatformStore } from '@/platforms'
import { useNotificationsStore } from '@/stores'

export function useInjectedConnect() {
    const platformStore = useActivePlatformStore()
    const notificationsStore = useNotificationsStore()
    const router = useRouter()
    const isConnecting = ref(false)

    /**
     * @param targetRoute Where to land on success. Defaults to `/wallet` —
     * the ordinary "just log me in" case.
     */
    const connectInjected = async (targetRoute: string = '/wallet'): Promise<void> => {
        if (isConnecting.value) return

        // Read from the ACTIVE platform rather than always calling
        // Avalanche's own connect, so the single-platform fallback below
        // connects whichever platform is actually selected. Only used here
        // to confirm an injected method exists at all — which platforms
        // actually open is decided below.
        const method = platformStore.activePlatform?.accessMethods.find(
            (m) => m.id === 'injected' && m.kind === 'action' && m.run
        )
        if (!method?.run) {
            // No in-place injected connect for this platform (or no
            // extension at all) — fall back to the full access flow, same as
            // clicking "Access Wallet". `targetRoute` is lost here: the
            // access screen's own login methods (mnemonic, keystore, …) have
            // no way to carry a destination through, only the injected sweep
            // does. Landing on `/wallet` after a phrase/keystore login is the
            // existing behaviour everywhere else, so this doesn't regress
            // anything — it just doesn't (yet) extend the shortcut.
            router.push('/access')
            return
        }

        isConnecting.value = true
        try {
            if (platformStore.injectedConnectablePlatforms().length > 1) {
                const settled = await platformStore.connectWithInjected()
                const failed = settled.filter((r) => r.status === 'failed')

                if (failed.length === settled.length) {
                    // Nothing opened. One extension refusing every platform is
                    // one fact, usually "the user clicked Reject" — say it
                    // once rather than listing it per platform.
                    const messages = new Set(failed.map((r) => r.error))
                    throw new Error(
                        messages.size === 1
                            ? [...messages][0] ?? 'Failed to connect wallet.'
                            : 'Failed to connect wallet.'
                    )
                }

                if (failed.length) {
                    // Partial pass: some platforms opened, at least one was
                    // declined. There's no results box here the way Menu.vue
                    // has one — say it as a toast instead of navigating past
                    // it silently.
                    notificationsStore.add({
                        type: 'error',
                        title: 'Connect Wallet',
                        message: `Connected ${settled.length - failed.length} of ${
                            settled.length
                        }. ${failed.map((r) => r.error).join(' ')}`,
                    })
                }

                router.push(targetRoute)
            } else {
                // The single-platform access method navigates itself (to
                // `/wallet`, unconditionally — see e.g. evm/store.ts
                // `connectInjected` / mainStore.accessWalletInjected), with no
                // way for this caller to hand it a different destination.
                // Push again right behind it: Vue Router simply supersedes an
                // in-flight (or just-finished) transition with the new one,
                // so this lands on `targetRoute` instead.
                await method.run()
                router.push(targetRoute)
            }
        } catch (e: any) {
            console.error('Wallet connection failed:', e)
            notificationsStore.add({
                type: 'error',
                title: 'Connect Wallet',
                message: e?.message || 'Failed to connect wallet.',
            })
        } finally {
            isConnecting.value = false
        }
    }

    return { isConnecting, connectInjected }
}
