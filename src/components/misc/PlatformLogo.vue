<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<!--
    The app wordmark, rendered as inline SVG so it can be re-tinted per platform.

    It has to be inline: the sidebar/navbar previously used a PNG, and a raster
    image cannot be recoloured without CSS filter hacks that only approximate a
    target colour. Inlining the paths lets the fills bind directly to the active
    platform's theme, so "logo turns to the platform colour" is exact.

    With no platform theme the original AVXTO red gradient renders unchanged.
-->
<template>
    <svg
        class="platform_logo"
        viewBox="0 0 466 134"
        role="img"
        :aria-label="`${label} logo`"
        xmlns="http://www.w3.org/2000/svg"
    >
        <defs>
            <linearGradient :id="gradientId" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" :stop-color="gradientFrom" />
                <stop offset="1" :stop-color="gradientTo" />
            </linearGradient>
        </defs>

        <!-- icon -->
        <g transform="translate(0,0) scale(0.67)">
            <rect x="0" y="0" width="200" height="200" rx="44" :fill="`url(#${gradientId})`" />
            <circle cx="148" cy="52" r="17" :fill="accentDot" opacity="0.95" />
            <path :fill="markFill" opacity="0.45" d="M105,42 L152,148 L48,148 Z" />
            <path :fill="markFill" d="M68,68 L118,148 L18,148 Z" />
            <path :fill="gradientTo" d="M68,68 L79,84 L57,84 Z" />
        </g>

        <!-- wordmark -->
        <text
            x="160"
            y="92"
            font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
            font-weight="800"
            font-size="76"
            letter-spacing="1"
            :fill="wordmarkFill"
        >
            AVXTO
        </text>
    </svg>
</template>

<script lang="ts">
import { computed, defineComponent } from 'vue'
import { useActivePlatformStore } from '@/platforms'

/** The stock AVXTO palette, used whenever the platform declares no theme. */
const DEFAULT_GRADIENT_FROM = '#FF5D5D'
const DEFAULT_GRADIENT_TO = '#E22B3C'
const DEFAULT_ACCENT_DOT = '#FFE8C2'

let gradientSeq = 0

export default defineComponent({
    name: 'PlatformLogo',
    setup() {
        const platformStore = useActivePlatformStore()

        // Gradient ids must be unique per instance: SVG defs live in one global
        // id namespace, so two instances (sidebar + navbar) sharing an id would
        // make the second one reference the first's gradient.
        const gradientId = `platform_logo_grad_${gradientSeq++}`

        const theme = computed(() => platformStore.activePlatform?.descriptor.theme)
        const label = computed(() => platformStore.activePlatform?.descriptor.name ?? 'AVXTO')

        /**
         * A themed platform paints the mark in a single flat colour rather than
         * the two-stop red gradient — tinting a gradient toward one hue tends
         * to muddy it, and a flat brand colour is what a platform theme means.
         */
        const gradientFrom = computed(() => theme.value?.logo ?? DEFAULT_GRADIENT_FROM)
        const gradientTo = computed(() => theme.value?.logo ?? DEFAULT_GRADIENT_TO)
        const wordmarkFill = computed(() => theme.value?.logo ?? DEFAULT_GRADIENT_TO)

        // Shapes sitting on top of the icon square must contrast with it, so on
        // a themed logo they follow the theme's on-accent colour instead of the
        // white/cream that only reads against the default red.
        const markFill = computed(() => theme.value?.onAccent ?? '#ffffff')
        const accentDot = computed(() => theme.value?.onAccent ?? DEFAULT_ACCENT_DOT)

        return {
            gradientId,
            gradientFrom,
            gradientTo,
            wordmarkFill,
            markFill,
            accentDot,
            label,
        }
    },
})
</script>

<style scoped lang="scss">
.platform_logo {
    display: block;
    width: 100%;
    height: auto;
}
</style>
