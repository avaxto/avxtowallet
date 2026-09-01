<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<!--
  A permanent, unconditional disclaimer — unlike StatusBar (live connection
  state) or the offline-signing banner (only when that mode is on), this has
  no store and no visibility toggle: the app is experimental for every
  visitor, logged in or not, so it always renders.

  Stacked directly below StatusBar at the very bottom of the viewport — see
  the "stacked bottom bars" comment on .status-bar in StatusBar.vue for how
  the two share that space without overlapping.
-->
<template>
    <div class="experimental_banner">
        AVXTO Wallet is still experimental and under heavy development — use with caution. No warranties implied.
    </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue'

export default defineComponent({
    name: 'ExperimentalBanner',
})
</script>

<style scoped lang="scss">
.experimental_banner {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 9998; // one below StatusBar's 9999 — it sits above this, not the reverse
    display: flex;
    align-items: left;
    justify-content: left;
    // Matches StatusBar's own min-height: the two are meant to read as one
    // continuous two-line strip, not two mismatched bars.
    min-height: 26px;
    padding: 4px 20px;
    text-align: left;
    font-size: 11px;
    background-color: var(--bg-light);
    color: var(--primary-color-light);
    opacity: 0.85;
}
</style>
