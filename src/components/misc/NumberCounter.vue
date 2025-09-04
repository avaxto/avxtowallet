<template>
    <p>{{ tweenedNumber.toLocaleString() }}</p>
</template>
<script lang="ts">
import { defineComponent, ref, watch, onMounted, type PropType } from 'vue'
import Big from 'big.js'

export default defineComponent({
    name: 'NumberCounter',
    props: {
        value: {
            type: Object as PropType<Big>,
            required: true
        }
    },
    setup(props) {
        const tweenedNumber = ref<Big>(Big(0))

        const animate = () => {
            let increment = props.value.gt(tweenedNumber.value)
            let diff = props.value.sub(tweenedNumber.value)
            let step = diff.div(4).abs()

            let thresh = Big(0.01)

            step = step.round(2)

            if (step.lt(thresh)) {
                tweenedNumber.value = props.value.add(0)
                return
            }

            if (increment) {
                tweenedNumber.value = tweenedNumber.value.add(step)
            } else {
                tweenedNumber.value = tweenedNumber.value.sub(step)
            }
            requestAnimationFrame(animate)
        }

        watch(() => props.value, () => {
            animate()
        })

        onMounted(() => {
            animate()
        })

        return {
            tweenedNumber,
            animate
        }
    }
})
</script>
