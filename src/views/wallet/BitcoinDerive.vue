<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<!--
  For an HD (recovery-phrase) wallet: shows every well-known address this
  wallet's phrase can produce — this app's own four standard types plus the
  Core-compatible one already used for fund discovery, and, for comparison
  against other software, Electrum's and Bitcoin Core's own non-standard
  conventions and an arbitrary custom BIP32 path.

  For a wallet imported from a single private key: there is no seed to derive
  other PATHS from, so instead this shows the one key re-encoded under each
  of the four address types — see WifBitcoinWallet.deriveAddressVariants.

  Purely a comparison/verification tool. Nothing shown here changes which
  address THIS wallet actually holds funds at — see platforms/bitcoin/store.ts
  (accessWithMnemonic / accessWithPrivateKey) and bitcoin/discovery.ts for
  that. See bitcoin/altSchemes.ts for exactly how the Electrum and Bitcoin
  Core conventions were verified.
-->
<template>
    <div class="derive_page">
        <div class="head">
            <h1>Bitcoin Derived Addresses</h1>
            <p class="desc">{{ headerDesc }}</p>
        </div>

        <div v-if="!isSupported" class="unsupported">
            <p>
                This tool needs a Bitcoin wallet with signing material — a watch-only wallet has
                no key to derive or re-encode addresses from.
            </p>
        </div>

        <template v-else>
            <div v-if="isHdWallet" class="custom_row">
                <label for="custom_path">Custom BIP32 path (optional)</label>
                <input
                    id="custom_path"
                    v-model="customPath"
                    class="path_input"
                    placeholder="m/0'/0'"
                    spellcheck="false"
                    autocomplete="off"
                />
            </div>
            <p v-else class="desc single_key_note">
                This wallet was imported from a single private key, not a recovery phrase, so
                there's no seed to derive other paths from — only this custom path input is
                skipped, everything below still works.
            </p>

            <v-btn
                depressed
                class="button_primary derive_but"
                :loading="isDeriving"
                @click="derive"
            >
                {{ hasDerived ? 'Re-derive' : 'Show derived addresses' }}
            </v-btn>

            <p v-if="err" class="error">{{ err }}</p>
            <p v-if="customPathError" class="error">Custom path: {{ customPathError }}</p>

            <div v-if="rows.length" class="results">
                <div
                    v-for="group in groupedRows"
                    :key="group.scheme"
                    class="scheme_group"
                >
                    <div class="scheme_head">
                        <h3>{{ group.scheme }}</h3>
                        <span class="path mono">{{ group.path }}</span>
                    </div>
                    <div v-for="row in group.rows" :key="row.addressType" class="row">
                        <span class="type_tag">{{ typeLabel(row.addressType) }}</span>
                        <a
                            :href="addressUrl(row.address)"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="mono addr"
                        >
                            {{ row.address }}
                        </a>
                        <CopyText :value="row.address" class="copy_btn" />
                    </div>
                </div>
            </div>

            <p class="fine_print">
                One password entry covers this whole comparison — nothing here is signed or
                broadcast, and nothing shown changes which address this wallet actually sends
                and receives from.
            </p>
        </template>
    </div>
</template>

<script lang="ts">
import { defineComponent, computed, ref, onMounted } from 'vue'
import { useBitcoinStore } from '@/platforms/bitcoin/store'
import { HdBitcoinWallet, WifBitcoinWallet, type DerivedAddressRow } from '@/platforms/bitcoin/wallet'
import { ADDRESS_TYPE_INFO, getBitcoinAddressUrl } from '@/bitcoin/networks'
import { authorizeSingle, SessionAuthCancelled } from '@/js/security/authorize'
import CopyText from '@/components/misc/CopyText.vue'

interface SchemeGroup {
    scheme: string
    path: string
    rows: DerivedAddressRow[]
}

export default defineComponent({
    name: 'BitcoinDerive',
    components: { CopyText },
    setup() {
        const btc = useBitcoinStore()

        const customPath = ref('')
        const isDeriving = ref(false)
        const err = ref('')
        const rows = ref<DerivedAddressRow[]>([])
        const customPathError = ref<string | null>(null)
        const hasDerived = ref(false)

        const wallet = computed(() => btc.wallet)
        const isHdWallet = computed(() => wallet.value instanceof HdBitcoinWallet)
        const isSupported = computed(
            () => wallet.value instanceof HdBitcoinWallet || wallet.value instanceof WifBitcoinWallet
        )

        const headerDesc = computed(() =>
            isHdWallet.value
                ? "Every address your recovery phrase produces, across this wallet's own standard types and the conventions other Bitcoin software uses — so you can check what's shown here against Electrum, Bitcoin Core, or anywhere else."
                : 'The address this private key produces under each of the four standard Bitcoin address types — useful for checking it against what another wallet shows for the same key.'
        )

        const groupedRows = computed((): SchemeGroup[] => {
            const groups: SchemeGroup[] = []
            for (const row of rows.value) {
                let group = groups.find((g) => g.scheme === row.scheme)
                if (!group) {
                    group = { scheme: row.scheme, path: row.path, rows: [] }
                    groups.push(group)
                }
                group.rows.push(row)
            }
            return groups
        })

        const typeLabel = (type: DerivedAddressRow['addressType']): string =>
            ADDRESS_TYPE_INFO[type].label

        const addressUrl = (address: string): string =>
            getBitcoinAddressUrl(address, btc.network)

        const derive = async () => {
            const w = wallet.value
            if (!(w instanceof HdBitcoinWallet) && !(w instanceof WifBitcoinWallet)) return

            err.value = ''
            customPathError.value = null
            isDeriving.value = true
            try {
                const result =
                    w instanceof HdBitcoinWallet
                        ? await authorizeSingle(
                              w,
                              'Show every known Bitcoin address for this phrase',
                              () => w.deriveKnownSchemes(customPath.value)
                          )
                        : await authorizeSingle(
                              w,
                              'Show this private key under every address type',
                              () => w.deriveAddressVariants()
                          )
                rows.value = result.rows
                customPathError.value = result.customPathError
                hasDerived.value = true
            } catch (e: any) {
                if (e instanceof SessionAuthCancelled) return
                err.value = e?.message ?? String(e)
            } finally {
                isDeriving.value = false
            }
        }

        // Preload the default-path addresses as soon as the page opens,
        // rather than making the user click through to see them — this DOES
        // mean the session-password prompt can appear immediately on
        // navigating here, same as it would on the first manual click. Only
        // `onMounted`, not `onActivated`: Wallet.vue keep-alives this route,
        // so navigating away and back re-shows the already-derived `rows`
        // from cache with no repeat prompt, and only a genuinely fresh visit
        // triggers a new one.
        onMounted(() => {
            if (isSupported.value) void derive()
        })

        return {
            isSupported,
            isHdWallet,
            headerDesc,
            customPath,
            isDeriving,
            err,
            rows,
            groupedRows,
            customPathError,
            hasDerived,
            typeLabel,
            addressUrl,
            derive,
        }
    },
})
</script>

<style scoped lang="scss">
@use '../../main';

.derive_page {
    max-width: 720px;
    margin: 0 auto;
}

.head {
    margin-bottom: 20px;
    text-align: center;
}

h1 {
    font-weight: normal;
}

.desc {
    color: var(--primary-color-light);
    font-size: 0.9em;
    margin-top: 4px;
}

.unsupported {
    color: var(--primary-color-light);
    padding: 20px 0;
    text-align: center;
}

.single_key_note {
    margin-bottom: 16px;
}

.custom_row {
    margin-bottom: 16px;

    label {
        display: block;
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.03em;
        color: var(--primary-color-light);
        margin-bottom: 8px;
    }
}

.path_input {
    width: 100%;
    padding: 12px 16px;
    font-family: monospace;
    font-size: 0.95em;
    border: 1px solid var(--bg);
    background-color: var(--bg-light);
    color: var(--primary-color);
    border-radius: 6px;
    outline: none;

    &:focus {
        border-color: var(--primary-color);
    }
}

.derive_but {
    width: 100%;
    margin-bottom: 16px;
}

.mono {
    font-family: monospace;
}

.error {
    text-align: center;
    color: var(--secondary-color);
    background-color: var(--bg-light);
    padding: 10px 16px;
    border-radius: 6px;
    font-size: 0.9em;
    margin-bottom: 12px;
}

.results {
    display: flex;
    flex-direction: column;
    gap: 14px;
}

.scheme_group {
    background-color: var(--bg-light);
    border-radius: 6px;
    overflow: hidden;
}

.scheme_head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
    padding: 10px 16px;
    background-color: var(--bg);

    h3 {
        margin: 0;
        font-size: 0.85em;
        font-weight: 600;
    }

    .path {
        font-size: 0.75em;
        color: var(--primary-color-light);
    }
}

.row {
    display: grid;
    grid-template-columns: 100px 1fr 28px;
    align-items: center;
    gap: 10px;
    padding: 10px 16px;
    font-size: 0.85em;

    & + .row {
        border-top: 1px solid var(--bg);
    }

    .type_tag {
        color: var(--primary-color-light);
        font-size: 0.85em;
    }

    .addr {
        word-break: break-all;
        color: var(--primary-color);
        text-decoration: none;

        &:hover {
            text-decoration: underline;
        }
    }
}

.fine_print {
    margin-top: 20px;
    font-size: 0.75em;
    color: var(--primary-color-light);
    text-align: center;
    line-height: 1.5;
}

@include main.mobile-device {
    .row {
        grid-template-columns: 1fr;
        gap: 4px;
    }

    .scheme_head {
        flex-direction: column;
        align-items: flex-start;
        gap: 2px;
    }
}
</style>
