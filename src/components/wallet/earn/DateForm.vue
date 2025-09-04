<template>
    <div class="dates_form">
        <!--        <div>-->
        <!--            <label>{{ $t('earn.validate.duration.start') }}</label>-->
        <!--            <datetime-->
        <!--                v-model="localStart"-->
        <!--                type="datetime"-->
        <!--                class="date hover_border"-->
        <!--                :min-datetime="startDateMin"-->
        <!--                :max-datetime="startDateMax"-->
        <!--            ></datetime>-->
        <!--        </div>-->
        <div class="hover_border">
            <button class="max_but" @click="maxoutEndDate">Max</button>
            <datetime
                v-model="localEnd"
                type="datetime"
                class="date"
                :min-datetime="endDateMin"
                :max-datetime="endDateMax"
            ></datetime>
        </div>
    </div>
</template>
<script lang="ts">
import { DAY_MS, MINUTE_MS } from '../../../constants'
import { defineComponent, ref, computed, watch, onMounted } from 'vue'

const MIN_STAKE_DURATION = DAY_MS * 14

interface Props {
    maxEndDate?: string
}

export default defineComponent({
    name: 'DateForm',
    props: {
        maxEndDate: {
            type: String,
            default: undefined
        }
    },
    emits: ['change_end'],
    setup(props: Props, { emit }) {
        const localStart = ref('')
        const localEnd = ref('')

        const startDateMin = computed(() => {
            let now = Date.now()
            let res = now + MINUTE_MS * 15
            return new Date(res).toISOString()
        })

        const endDateMin = computed(() => {
            let start = localStart.value
            let startDate = new Date(start)

            let end = startDate.getTime() + MIN_STAKE_DURATION
            let endDate = new Date(end)
            return endDate.toISOString()
        })

        const endDateMax = computed(() => {
            if (props.maxEndDate) return props.maxEndDate

            let start = localStart.value
            let startDate = new Date(start)

            let end = startDate.getTime() + DAY_MS * 365
            let endDate = new Date(end)
            return endDate.toISOString()
        })

        const defaultEndDate = computed(() => {
            let start = localStart.value
            let startDate = new Date(start)

            let end = startDate.getTime() + DAY_MS * 21
            let endDate = new Date(end)
            return endDate.toISOString()
        })

        const stakeDuration = computed((): number => {
            let start = new Date(localStart.value)
            let end = new Date(localEnd.value)
            let diff = end.getTime() - start.getTime()
            return diff
        })

        watch(() => localEnd.value, (val: string) => {
            setEndDate(val)

            let endTime = new Date(val).getTime()
            let minDateTime = new Date(endDateMin.value).getTime()

            if (endTime < minDateTime) {
                localEnd.value = endDateMin.value
            }
        })

        onMounted(() => {
            localStart.value = startDateMin.value

            // default end date is 3 weeks
            localEnd.value = defaultEndDate.value

            setEndDate(localEnd.value)
        })

        const setEndDate = (val: string) => {
            emit('change_end', val)
        }

        const maxoutEndDate = () => {
            localEnd.value = endDateMax.value
        }

        return {
            localStart,
            localEnd,
            startDateMin,
            endDateMin,
            endDateMax,
            defaultEndDate,
            stakeDuration,
            setEndDate,
            maxoutEndDate
        }
    }
})
</script>
<style lang="scss">
.dates_form {
    .date input {
        border: none !important;
        text-align: right;
        width: 100%;
    }
}
</style>
<style scoped lang="scss">
.dates_form {
    display: grid;
    grid-template-columns: 1fr;
    grid-gap: 15px;
    width: 100%;

    > div {
        width: 100%;
        display: grid;
        grid-template-columns: max-content 1fr;
        background-color: var(--bg-light);
    }

    label > span {
        float: right;
        opacity: 0.4;
        cursor: pointer;
        &:hover {
            opacity: 1;
        }
    }
}

.max_but {
    padding-left: 12px;
    color: var(--primary-color-light);
    &:hover {
        color: var(--primary-color);
    }
}
</style>
