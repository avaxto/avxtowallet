<template>
    <!--    <p @keydown.up="up" @keydown.down="down"-->
    <!--       @input="input" >{{display}}</p>-->
    <input
        type="text"
        v-model="raw"
        @keydown.up="up"
        @keydown.down="down"
        contenteditable="false"
        @input="input"
        @change="change"
    />
</template>
<script>
import Big from 'big.js'
import { BN } from '@/avalanche'
import { toRaw } from 'vue'

export default {
    emits: ['change'],
    data() {
        return {
            raw: '0',
            value: null,
        }
    },
    created() {
        this.value = new Big(0)
    },
    computed: {
        stepSize() {
            return Math.pow(10, -this.denomination)
        },
        bigMax() {
            if (this.max) {
                try {
                    // toRaw to unwrap Vue reactive proxy from BN
                    let rawMax = toRaw(this.max)
                    let satoshi = Big(rawMax.toString(10))
                    let divider = Big(10).pow(this.denomination)
                    return satoshi.div(divider)
                } catch (e) {
                    return null
                }
            }
            return null
        },
        bigMin() {
            if (typeof this.min != 'undefined') {
                return Big(this.min)
            }
            return null
        },
    },
    mounted() {
        this.cleanInput()
    },
    props: {
        denomination: {
            type: Number,
            default: 0,
        },
        max: {
            type: [BN, null],
        },
        min: {
            type: Number,
            default: 0,
        },
    },
    watch: {
        denomination() {
            this.cleanInput()
        },
    },
    methods: {
        // Emit in BN as satoshis!
        emit() {
            let tens = Big(10).pow(this.denomination)
            let satoshis = this.value.times(tens)
            let bn = new BN(satoshis.toFixed(0))
            this.$emit('change', bn)
        },
        change(ev) {
            // TODO check why this is being called, seems like a bug
            //this.cleanInput()
        },
        input(ev) {
            try {
                let rawnum = new Big(this.raw)
                if (this.bigMax != null) {
                    if (rawnum.gt(this.bigMax)) rawnum = this.bigMax
                    else if (rawnum.lt(this.bigMin)) rawnum = this.bigMin
                }
                this.value = rawnum
                this.emit()
            } catch (e) {
                // raw not yet parseable, wait for more input
            }
        },
        cleanInput() {
            let rawnum
            try {
                if (this.raw === '') this.raw = 0
                rawnum = new Big(this.raw)
            } catch (err) {
                rawnum = this.value
            }

            try {
                if (this.bigMax != null) {
                    if (rawnum.gt(this.bigMax)) {
                        rawnum = this.bigMax
                    } else if (rawnum.lt(this.bigMin)) {
                        rawnum = this.bigMin
                    }
                }
            } catch (e) {
                // bigMax comparison failed, skip clamping
            }
            this.value = rawnum
            this.raw = rawnum.toFixed(this.denomination)
            this.emit()
        },
        clear() {
            this.value = new Big(0)
            this.raw = new Big(0).toFixed(this.denomination)
            this.emit()
        },
        maxout() {
            if (this.bigMax) {
                this.value = this.bigMax
                this.valueToRaw()
            }
        },
        up(ev) {
            this.value = this.value.plus(this.stepSize)
            this.valueToRaw()
        },
        valueToRaw() {
            let val = this.value
            if (this.bigMax != null) {
                if (val.gt(this.bigMax)) {
                    val = this.bigMax
                    this.value = val
                } else if (val.lt(this.bigMin)) {
                    val = this.bigMin
                    this.value = val
                }
            }
            this.raw = val.toFixed(this.denomination)
            this.emit()
        },
        down(ev) {
            this.value = this.value.minus(this.stepSize)
            this.valueToRaw()
        },
    },
}
</script>
