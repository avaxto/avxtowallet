<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<!--
  Hands a block of text to another app — messenger, mail client, clipboard.

  Every target here works by opening a URL the OS or browser routes to the
  installed app, so nothing is transmitted by this wallet itself and no
  account or API key is involved. Signal is the exception: it has no
  documented share URL that accepts a prefilled body, so it falls back to
  copying and telling the user to paste. Pretending otherwise with a
  half-working link would be worse than saying so.
-->
<template>
    <div class="share_links">
        <p class="share_label">{{ label }}</p>
        <div class="share_buttons">
            <a
                class="share_btn"
                :href="whatsappUrl"
                target="_blank"
                rel="noopener noreferrer"
                title="Share via WhatsApp"
            >
                WhatsApp
            </a>
            <a
                class="share_btn"
                :href="telegramUrl"
                target="_blank"
                rel="noopener noreferrer"
                title="Share via Telegram"
            >
                Telegram
            </a>
            <button class="share_btn" @click="shareSignal" title="Copy for Signal">
                {{ signalCopied ? 'Copied — paste in Signal' : 'Signal' }}
            </button>
            <a class="share_btn" :href="mailUrl" title="Share via email">Email</a>
            <button class="share_btn primary" @click="copyAll">
                {{ copied ? 'Copied' : 'Copy' }}
            </button>
        </div>
        <p v-if="tooLongForLink" class="share_note">
            This transaction is long enough that some messengers may truncate it in a prefilled
            link. If the recipient reports a broken transaction, use Copy and paste it into the
            conversation directly.
        </p>
    </div>
</template>

<script lang="ts">
import { defineComponent, computed, ref } from 'vue'

/**
 * Roughly where prefilled-link truncation starts to bite in practice. Not a
 * hard limit anywhere — messengers and browsers differ — so it drives a
 * warning rather than disabling the buttons.
 */
const LINK_LENGTH_WARNING = 1800

export default defineComponent({
    name: 'ShareLinks',
    props: {
        /** The full text to share — message plus payload. */
        text: {
            type: String,
            required: true,
        },
        /**
         * What the plain "Copy" button puts on the clipboard. Defaults to
         * `text`, but the payload usually wants just the raw string on its
         * own — the instructional message is there to give WhatsApp/Telegram/
         * Signal/email recipients context for a link arriving out of the
         * blue, not to be prepended every time the string itself is pasted
         * somewhere (another form's paste box, a file, a terminal).
         */
        copyText: {
            type: String,
            default: null,
        },
        /** Subject line, email only. */
        subject: {
            type: String,
            default: 'Partially signed Avalanche transaction',
        },
        label: {
            type: String,
            default: 'Send it to the other signers',
        },
    },
    setup(props) {
        const copied = ref(false)
        const signalCopied = ref(false)

        const encoded = computed(() => encodeURIComponent(props.text))
        const plainCopyValue = computed(() => props.copyText ?? props.text)

        const whatsappUrl = computed(() => `https://wa.me/?text=${encoded.value}`)
        // Telegram's share URL wants the body in `text`; `url` is required but
        // may be empty, and leaving it out drops the text entirely.
        const telegramUrl = computed(() => `https://t.me/share/url?url=&text=${encoded.value}`)
        const mailUrl = computed(
            () => `mailto:?subject=${encodeURIComponent(props.subject)}&body=${encoded.value}`
        )

        const tooLongForLink = computed(() => props.text.length > LINK_LENGTH_WARNING)

        const write = async (value: string): Promise<boolean> => {
            try {
                await navigator.clipboard?.writeText(value)
                return true
            } catch {
                return false
            }
        }

        // Copies just the payload — see the copyText prop doc.
        const copyAll = async () => {
            if (await write(plainCopyValue.value)) {
                copied.value = true
                setTimeout(() => (copied.value = false), 2000)
            }
        }

        // Signal has no share URL that accepts a prefilled body, so this
        // stands in for a genuine share action rather than for the plain
        // Copy button — it carries the full message, the same context a
        // WhatsApp/Telegram share would.
        const shareSignal = async () => {
            if (await write(props.text)) {
                signalCopied.value = true
                setTimeout(() => (signalCopied.value = false), 3000)
            }
        }

        return {
            copied,
            signalCopied,
            whatsappUrl,
            telegramUrl,
            mailUrl,
            tooLongForLink,
            copyAll,
            shareSignal,
        }
    },
})
</script>

<style scoped lang="scss">
.share_links {
    margin-top: 16px;
}

.share_label {
    font-size: 12px;
    font-weight: bold;
    color: var(--primary-color-light);
    margin-bottom: 8px;
}

.share_buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}

.share_btn {
    font-size: 13px;
    padding: 6px 14px;
    border-radius: 6px;
    background: var(--bg-light);
    color: var(--primary-color) !important;
    text-decoration: none;
    border: 1px solid var(--bg-light);
    cursor: pointer;

    &:hover {
        border-color: var(--secondary-color);
    }

    &.primary {
        background: var(--secondary-color);
        // The accent can be a high-luminance colour (see platforms/theme.ts),
        // where white text is unreadable — same token .button_secondary uses.
        color: var(--platform-on-accent, #fff) !important;
        border-color: var(--secondary-color);
    }
}

.share_note {
    margin-top: 8px;
    font-size: 11px;
    color: var(--primary-color-light);
    line-height: 1.5;
}
</style>
