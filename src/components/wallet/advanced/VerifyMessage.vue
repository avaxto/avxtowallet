<template>
    <div>
        <h2>{{ $t('advanced.verify.title') }}</h2>
        <p style="margin-bottom: 14px !important">
            {{ $t('advanced.verify.desc') }}
        </p>
        <div>
            <label>{{ $t('advanced.verify.label1') }}</label>
            <textarea v-model="message"></textarea>
        </div>
        <div>
            <label>{{ $t('advanced.verify.label2') }}</label>
            <textarea v-model="signature"></textarea>
        </div>
        <div>
            <label>Expected signer (optional)</label>
            <input
                v-model="expected"
                type="text"
                placeholder="X-avax1… or P-avax1…"
                autocomplete="off"
                spellcheck="false"
                data-1p-ignore
                data-lpignore="true"
            />
        </div>
        <v-btn
            class="button_secondary"
            block
            small
            depressed
            @click="submit"
            :disabled="!canSubmit"
        >
            {{ $t('advanced.verify.submit') }}
        </v-btn>
        <div v-if="outcome" class="result" :class="outcome">
            <div class="verdict_icon">
                <fa :icon="outcome === 'invalid' || outcome === 'mismatch' ? 'circle-xmark' : 'circle-check'"></fa>
            </div>
            <div class="verdict_body">
                <p class="verdict_title">{{ verdictTitle }}</p>
                <p class="verdict_note">{{ verdictNote }}</p>
                <template v-if="addressX">
                    <label>Signer</label>
                    <p class="address">{{ addressX }}</p>
                    <p class="address">{{ addressP }}</p>
                </template>
            </div>
        </div>
    </div>
</template>
<script lang="ts">
import { defineComponent, ref, computed } from 'vue'
import { ava } from '@/AVA'
import { errorToString } from '@/helpers/helper'
import { recoverSigner, signerMatches } from '@/helpers/verify_message'

/**
 * - valid: the signature recovered a signer; no expected signer was given
 * - match: it recovered the expected signer
 * - mismatch: it recovered a signer, but not the expected one
 * - invalid: it could not be decoded or recovered at all
 */
type Outcome = 'valid' | 'match' | 'mismatch' | 'invalid'

export default defineComponent({
    name: 'VerifyMessage',
    setup() {
        const message = ref('')
        const addressX = ref('')
        const addressP = ref('')
        const signature = ref('')
        const expected = ref('')
        const error = ref('')
        const outcome = ref<Outcome | null>(null)
        /** The expected address as it was when verified, for the verdict text. */
        const checkedAgainst = ref('')

        const verdictTitle = computed(() => {
            switch (outcome.value) {
                case 'match':
                    return 'Valid signature from the expected signer'
                case 'valid':
                    return 'Valid signature'
                case 'mismatch':
                    return 'Not signed by the expected signer'
                case 'invalid':
                    return 'Invalid signature'
            }
            return ''
        })
        const verdictNote = computed(() => {
            switch (outcome.value) {
                case 'match':
                    return `This message was signed by ${checkedAgainst.value}.`
                case 'valid':
                    return 'The signature is well formed and was made by the address below. Enter the address you expect above to confirm it is theirs — any signature recovers some address.'
                case 'mismatch':
                    return `This signature was made by the address below, not by ${checkedAgainst.value}. The message may have been altered, or signed by someone else.`
                case 'invalid':
                    return error.value || 'The signature could not be decoded.'
            }
            return ''
        })

        const canSubmit = computed(() => {
            if (!message.value || !signature.value) return false
            return true
        })

        const submit = () => {
            addressX.value = ''
            addressP.value = ''
            error.value = ''
            outcome.value = null
            try {
                verify()
            } catch (e) {
                error.value = errorToString(e)
                outcome.value = 'invalid'
            }
        }

        const verify = () => {
            const signer = recoverSigner(message.value, signature.value, ava.getNetworkID())
            addressX.value = signer.addressX
            addressP.value = signer.addressP
            checkedAgainst.value = expected.value.trim()
            if (!checkedAgainst.value) outcome.value = 'valid'
            else outcome.value = signerMatches(checkedAgainst.value, signer) ? 'match' : 'mismatch'
        }

        const clear = () => {
            message.value = ''
            signature.value = ''
            expected.value = ''
            addressX.value = ''
            addressP.value = ''
            error.value = ''
            outcome.value = null
        }

        return {
            message,
            addressX,
            addressP,
            signature,
            expected,
            error,
            outcome,
            verdictTitle,
            verdictNote,
            canSubmit,
            submit,
            verify,
            clear
        }
    },
    deactivated() {
        this.clear()
    }
})
</script>
<style lang="scss" scoped>
textarea,
input,
.address {
    padding: 6px 12px;
    width: 100%;
    background-color: rgba(0, 0, 0, 0.1);
    font-size: 13px;
}

label {
    display: block;
    text-align: left;
    color: var(--primary-color-light);
    font-size: 12px;
    margin-bottom: 20px;
    margin-top: 6px;
}

textarea {
    width: 100%;
    resize: none;
    padding: 6px 12px;
    height: 80px;
}

.result {
    display: flex;
    align-items: flex-start;
    gap: 16px;
    margin-top: 16px;
    padding: 16px;
    border-radius: 10px;
    border: 1px solid;

    &.valid,
    &.match {
        border-color: var(--success);
        background-color: rgba(107, 198, 136, 0.08);

        .verdict_icon,
        .verdict_title {
            color: var(--success);
        }
    }

    &.mismatch,
    &.invalid {
        border-color: var(--error);
        background-color: rgba(232, 73, 112, 0.08);

        .verdict_icon,
        .verdict_title {
            color: var(--error);
        }
    }
}

.verdict_icon {
    font-size: 48px;
    line-height: 1;
    flex-shrink: 0;
}

.verdict_body {
    flex: 1;
    min-width: 0;

    label {
        margin: 10px 0 6px;
    }
}

.verdict_title {
    font-size: 16px;
    font-weight: 700;
}

.verdict_note {
    font-size: 12.5px;
    color: var(--primary-color-light);
    margin-top: 4px !important;
    line-height: 1.5;
}

.address {
    margin-bottom: 1px !important;
    word-break: break-all;
}
</style>
