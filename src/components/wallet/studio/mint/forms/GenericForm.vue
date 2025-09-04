<template>
    <div>
        <div class="input_cont">
            <label>{{ $t('studio.mint.forms.generic.label1') }}</label>
            <input class="text" max="128" v-model="title" @input="onInput" />
        </div>
        <div class="input_cont">
            <label>{{ $t('studio.mint.forms.generic.label2') }}</label>
            <input class="text" placeholder="https://" v-model="imgUrl" @input="onInput" />
        </div>
        <div class="input_cont">
            <label>{{ $t('studio.mint.forms.generic.label3') }}</label>
            <textarea class="text" maxlength="256" v-model="description" @input="onInput" />
        </div>
        <!--        <div class="input_cont">-->
        <!--            <label>Corner Radius</label>-->
        <!--            <input type="number" min="0" max="100" v-model="radius"  @input="onInput"/>-->
        <!--        </div>-->
        <p class="err">{{ error }}</p>
    </div>
</template>
<script lang="ts">
import { defineComponent, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
    GenericFormType,
    IGenericNft,
    UrlFormType,
    UtfFormType,
} from '@/components/wallet/studio/mint/types'

export default defineComponent({
    name: 'GenericForm',
    emits: ['onInput'],
    setup(props, { emit }) {
        const { t } = useI18n()
        const title = ref('')
        const description = ref('')
        const imgUrl = ref('')
        const error = ref('')
        // const radius = ref(15)

        const validate = () => {
            // if (!title.value) {
            //     error.value = 'You must set a title.'
            //     return false
            // }

            try {
                new URL(imgUrl.value)
            } catch (e) {
                error.value = t('studio.mint.forms.generic.err1') as string
                // error.value = 'Not a valid Image URL.'
                return false
            }
            if (!imgUrl.value) {
                error.value = t('studio.mint.forms.generic.err2') as string
                // error.value = 'You must set the image.'
                return false
            }

            if (imgUrl.value.length > 516) {
                error.value = t('studio.mint.forms.generic.err3') as string
                // error.value = 'Image URL too long.'
                return false
            }

            // if (radius.value < 0 || radius.value > 100) {
            //     error.value = 'Invalid corner radius.'
            //     return false
            // }

            return true
        }

        const onInput = () => {
            let msg: null | GenericFormType = null
            error.value = ''

            if (validate()) {
                const data: IGenericNft = {
                    version: 1,
                    type: 'generic',
                    title: title.value,
                    img: imgUrl.value,
                    // radius: radius.value,
                    desc: description.value,
                }

                msg = {
                    data: {
                        avalanche: data,
                    },
                }
            }
            emit('onInput', msg)
        }

        return {
            title,
            description,
            imgUrl,
            error,
            // radius,
            onInput
        }
    }
})
</script>
<style scoped lang="scss">
textarea {
    width: 100%;
    height: 80px;
    max-width: 100%;
}

.input_cont {
    margin-top: 2px;
    width: 100%;

    input {
        width: 100%;
    }
}
.v-btn {
    margin-top: 14px;
}
.counter {
    text-align: right;
    font-size: 13px;
    color: var(--primary-color-light);
    padding: 2px;
}
</style>
