<template>
    <div>
        <v-checkbox
            :label="explain"
            :model-value="modelValue"
            class="checkbox"
            hide-details
            @update:model-value="(checked) => $emit('update:modelValue', !!checked)"
        ></v-checkbox>
    </div>
</template>
<script>
/**
 * "I have backed up my phrase" — the checkbox that unlocks verifying it on
 * /create. Used with `v-model`, Vue 3 style: `modelValue` in,
 * `update:modelValue` out.
 *
 * It was still wired the Vue 2 way (a `model: { prop, event }` option, which
 * Vue 3 ignores, and `:value`, which Vuetify 3 reads as the checkbox's value
 * in a group rather than whether it is ticked), so the parent's `v-model`
 * never changed: the box would not tick and the step could not be passed.
 */
export default {
    props: {
        modelValue: Boolean,
        explain: {
            type: String,
            default: 'Back up your mnemonic keyphrase!',
        },
    },
    emits: ['update:modelValue'],
}
</script>

<style lang="scss">
@use "../../main";

// Vuetify 3 class names (these used to target Vuetify 2's
// `.v-input--selection-controls__*`, which no longer exist, so none of it
// applied and the box and label fell back to the theme's colours). Explicit
// theme colours: light box and label on the dark page, accent when ticked.
.checkbox {
    .v-label {
        color: var(--primary-color) !important;
        opacity: 1;
    }

    .v-selection-control__input {
        color: var(--primary-color) !important;
    }

    .v-selection-control--dirty .v-selection-control__input {
        color: var(--secondary-color) !important;
    }
}
</style>
