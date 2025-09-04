<template>
    <div class="filter_settings">
        <div class="modal_body">
            <h3>{{ $t('earn.delegate.filter.title2') }}</h3>
            <div class="inputs">
                <div class="uptime">
                    <label>{{ $t('earn.delegate.filter.label1') }}</label>
                    <div class="input_row hover_border">
                        <input
                            type="number"
                            min="0"
                            step="1"
                            inputmode="numeric"
                            @input="onInputChange"
                            v-model="availableSpace"
                        />
                        <p>AVAX</p>
                    </div>
                </div>
                <div class="duration">
                    <label>{{ $t('earn.delegate.filter.label2') }}</label>
                    <div class="input_row slider_row">
                        <input
                            type="range"
                            min="14"
                            max="365"
                            step="1"
                            @input="onInputChange"
                            v-model="minDuration"
                        />
                        <p style="display: inline-block">{{ durationText }}</p>
                    </div>
                </div>
                <div class="fee">
                    <label>{{ $t('earn.delegate.filter.label3') }}</label>
                    <div class="input_row hover_border">
                        <input
                            type="number"
                            min="0"
                            max="100"
                            step="1"
                            inputmode="numeric"
                            @input="onInputChange"
                            v-model="maxFee"
                        />
                        <p>%</p>
                    </div>
                </div>
                <div class="uptime">
                    <label>{{ $t('earn.delegate.filter.label4') }}</label>
                    <div class="input_row hover_border">
                        <input
                            type="number"
                            min="0"
                            max="100"
                            step="1"
                            inputmode="numeric"
                            @input="onInputChange"
                            v-model="minUptime"
                        />
                        <p>%</p>
                    </div>
                </div>
            </div>

            <div class="preview">
                <p>{{ $t('earn.delegate.filter.preview', [count]) }}</p>
            </div>

            <div class="checkout">
                <v-btn
                    class="button_secondary"
                    depressed
                    :disabled="!canApply"
                    @click="apply"
                    small
                >
                    {{ $t('earn.delegate.filter.apply') }}
                </v-btn>
                <v-btn
                    text
                    v-if="activeFilter"
                    @click="clear"
                    class="button_primary"
                    style="margin: 8px 0px"
                    small
                    block
                >
                    {{ $t('earn.delegate.filter.clear') }}
                </v-btn>
                <button @click="close" class="button_form_cancel">
                    {{ $t('earn.delegate.filter.cancel') }}
                </button>
            </div>
        </div>
    </div>
</template>
<script lang="ts">
import { defineComponent, ref, computed, watch } from 'vue'
import moment from 'moment'
import { ValidatorListFilter } from '@/components/wallet/earn/Delegate/types'
import { ValidatorListItem } from '@/store/modules/platform/types'
import { filterValidatorList } from '@/components/wallet/earn/Delegate/helper'

const MINUTE_MS = 60000
const HOUR_MS = MINUTE_MS * 60
const DAY_MS = HOUR_MS * 24

export default defineComponent({
    name: 'FilterSettings',
    props: {
        validators: {
            type: Array as () => ValidatorListItem[],
            required: true
        }
    },
    emits: ['close', 'change'],
    setup(props, { emit }) {
        const minDuration = ref(14)
        const maxFee = ref(10)
        const minUptime = ref(90)
        const availableSpace = ref(25)
        const activeFilter = ref<null | ValidatorListFilter>(null)
        const count = ref(0)
        const timeout = ref<ReturnType<typeof setTimeout> | null>(null)

        const checkValues = () => {
            // max fee
            if (maxFee.value > 100) maxFee.value = 100
            if (maxFee.value < 0) maxFee.value = 0

            // uptime
            if (minUptime.value > 100) minUptime.value = 100
            if (minUptime.value < 0) minUptime.value = 0
        }

        const createFilter = (): ValidatorListFilter => {
            return {
                minDuration: minDuration.value,
                maxFee: maxFee.value,
                minUptime: minUptime.value,
                availableSpace: availableSpace.value,
            }
        }

        // Applies filters and calculates the validator count
        const updateCount = () => {
            const validators = props.validators
            const filter = createFilter()
            const res = filterValidatorList(validators, filter)
            count.value = res.length
        }

        const onInputChange = () => {
            checkValues()
            if (timeout.value) {
                clearTimeout(timeout.value)
            }

            timeout.value = setTimeout(() => {
                updateCount()
            }, 700)
        }

        const close = () => {
            emit('close')
        }

        const clear = () => {
            activeFilter.value = null
            emit('change', null)
            close()
        }

        const apply = () => {
            const filter: ValidatorListFilter = createFilter()
            activeFilter.value = filter
            emit('change', filter)
            close()
        }

        const durationText = computed(() => {
            const duration = moment.duration(minDuration.value * DAY_MS, 'milliseconds')
            return `${duration.months()} months ${duration.days()} days`
        })

        const canApply = computed(() => {
            if (count.value === 0) return false
            return true
        })

        // Watch validators prop for changes
        watch(() => props.validators, () => {
            updateCount()
        })

        return {
            minDuration,
            maxFee,
            minUptime,
            availableSpace,
            activeFilter,
            count,
            onInputChange,
            close,
            clear,
            apply,
            durationText,
            canApply
        }
    }
})
</script>
<style scoped lang="scss">
.filter_settings {
    background-color: rgba(var(--bg-1), 0.9);
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    align-items: center;
}

.modal_body {
    width: 100%;
    max-width: 360px;
    background-color: var(--bg-light);
    padding: 14px 30px;
    border: 1px solid #0004;
}

.inputs {
    > div {
        margin: 4px 0;
        color: var(--primary-color-light);
    }

    input {
        border: none !important;
        outline: none !important;
        color: var(--primary-color);
        padding-right: 8px;
    }
}

.input_row {
    display: grid;
    grid-template-columns: 1fr max-content;
    background-color: var(--bg);
    border: 1px solid rgba(0, 0, 0, 0.1);
    padding: 4px 12px;
    border-radius: 2px;
    margin-bottom: 4px;
    font-size: 14px;
}

.slider_row {
    display: flex;
    flex-direction: column;
    text-align: right;
    border: none;
    background-color: transparent;
    padding: 2px 0;

    input {
        margin: 4px 0;
    }
    p {
        margin: 0 !important;
    }
}
label {
    display: block;
    text-align: left;
    color: var(--primary-color-light);
    font-size: 12px;
    margin-bottom: 20px;
}

.duration {
    p {
        color: var(--primary-color-light);
    }
}

.fee,
.uptime {
    input {
        text-align: right;
    }
}

.preview {
    margin: 12px 0;
    font-size: 12px;
}

.checkout {
    text-align: center;
    justify-content: center;
    display: flex;
    flex-direction: column;
}
</style>
