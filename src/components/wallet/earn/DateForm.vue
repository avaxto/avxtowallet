<template>
    <div class="dates_form">
        <div class="hover_border">
            <button class="max_but" @click="maxoutEndDate">Max</button>
            <input
                type="datetime-local"
                v-model="localEndInput"
                class="date"
                :min="endDateMinLocal"
                :max="endDateMaxLocal"
            />
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

/** Convert an ISO string to the "YYYY-MM-DDTHH:MM" format expected by datetime-local inputs */
function isoToLocal(iso: string): string {
    if (!iso) return ''
    const d = new Date(iso)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
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
        const localStart = ref(new Date(Date.now() + MINUTE_MS * 15).toISOString())
        const localEnd = ref('')

        /** Two-way bridge: the <input type="datetime-local"> uses local time strings */
        const localEndInput = computed({
            get(): string {
                return isoToLocal(localEnd.value)
            },
            set(val: string) {
                // Input value is local time — parse as local and store as ISO
                localEnd.value = val ? new Date(val).toISOString() : ''
            }
        })

        const startDateMin = computed(() => {
            let now = Date.now()
            let res = now + MINUTE_MS * 15
            return new Date(res).toISOString()
        })

        const endDateMin = computed(() => {
            let start = localStart.value
            let startDate = new Date(start)
            let end = startDate.getTime() + MIN_STAKE_DURATION
            return new Date(end).toISOString()
        })

        const endDateMax = computed(() => {
            if (props.maxEndDate) return props.maxEndDate
            let start = localStart.value
            let startDate = new Date(start)
            let end = startDate.getTime() + DAY_MS * 365
            return new Date(end).toISOString()
        })

        const endDateMinLocal = computed(() => isoToLocal(endDateMin.value))
        const endDateMaxLocal = computed(() => isoToLocal(endDateMax.value))

        const defaultEndDate = computed(() => {
            let start = localStart.value
            let startDate = new Date(start)
            let end = startDate.getTime() + DAY_MS * 21
            return new Date(end).toISOString()
        })

        const stakeDuration = computed((): number => {
            let start = new Date(localStart.value)
            let end = new Date(localEnd.value)
            return end.getTime() - start.getTime()
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
            localEndInput,
            endDateMinLocal,
            endDateMaxLocal,
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
