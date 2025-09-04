<template>
    <modal ref="modal" :title="title" class="modal_parent" icy>
        <div class="mnemonic_body">
            <button @click="close" class="close_but">
                <fa icon="times"></fa>
            </button>
            <h3>{{ $t('create.verify_desc') }}</h3>
            <div class="words">
                <div v-for="i in 24" :key="i" class="mnemonic_in" tabindex="-1">
                    <p>{{ i }}.</p>
                    <input
                        type="text"
                        v-model="keysIn[i - 1]"
                        :disabled="!hiddenIndices.includes(i - 1)"
                    />
                </div>
            </div>
            <p class="err">{{ err }}</p>
            <button class="but_primary ava_button button_primary" @click="verify">Verify</button>
        </div>
    </modal>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'

import Modal from '@/components/modals/Modal.vue'
import MnemonicPhrase from '@/js/wallets/MnemonicPhrase'

export default defineComponent({
    name: 'VerifyMnemonic',
    components: {
        Modal,
    },
    props: {
        mnemonic: {
            type: Object as () => MnemonicPhrase,
            required: false
        }
    },
    emits: ['complete'],
    setup(props, { emit }) {
        const { t } = useI18n()
        
        const modal = ref<InstanceType<typeof Modal>>()
        const isActive = ref(false)
        const keysIn = ref<string[]>([])
        const hiddenIndices = ref<number[]>([])
        const err = ref('')
        const title = ref('')

        const words = computed(() => {
            return props.mnemonic ? props.mnemonic.getValue().split(' ') : []
        })

        const init = () => {
            const wordsLen = 24
            keysIn.value = Array(wordsLen).join('.').split('.')

            // Hide 4 words
            let hideNum = 4
            let hidden: number[] = []

            while (hidden.length < hideNum) {
                let hideIndex = Math.floor(Math.random() * wordsLen)
                if (!hidden.includes(hideIndex)) {
                    hidden.push(hideIndex)
                }
            }

            words.value.forEach((word, i) => {
                if (!hidden.includes(i)) {
                    keysIn.value[i] = word
                }
            })

            hiddenIndices.value = hidden
        }

        watch(() => props.mnemonic, (val) => {
            init()
        })

        onMounted(() => {
            init()
            title.value = t('create.verifytitle')
        })

        const open = () => {
            if (modal.value) {
                modal.value.open()
            }
        }

        const close = () => {
            isActive.value = false
        }

        const formCheck = () => {
            err.value = ''
            let userWords = keysIn.value

            for (var i = 0; i < userWords.length; i++) {
                let userWord = userWords[i].trim()
                let trueWord = words.value[i].trim()

                if (userWord.length === 0) {
                    err.value = `Oops, looks like you forgot to fill number ${i + 1}`
                    return false
                }

                if (userWord !== trueWord) {
                    err.value = `The mnemonic phrase you entered for word ${
                        i + 1
                    } not match the actual phrase.`
                    return false
                }
            }

            return true
        }

        const verify = () => {
            if (!formCheck()) return
            if (modal.value) {
                modal.value.close()
            }
            emit('complete')
        }

        return {
            modal,
            isActive,
            keysIn,
            hiddenIndices,
            err,
            title,
            words,
            open,
            close,
            formCheck,
            verify
        }
    }
})
</script>
<style scoped lang="scss">
@use "../../main";

.mnemonic_body {
    padding: 30px;
    text-align: center;
    max-width: 100%;
    width: 450px;
}

.close_but {
    position: absolute;
    top: 12px;
    right: 20px;
    background-color: transparent;
    border: none;
    outline: none;
    opacity: 0.2;

    &:hover {
        opacity: 1;
    }
}

.verify {
    position: fixed;
    height: 100%;
    width: 100%;
    top: 0;
    left: 0;
    z-index: 99;
    display: flex;
    justify-content: center;
    align-items: center;
}

.bg {
    position: absolute;
    width: 100%;
    height: 100%;
    background-color: rgba(0, 0, 0, 0.8);
}

.content {
    position: relative;
    background-color: #fff;
    padding: 40px 30px;
    max-width: 100%;
    width: 700px;
    z-index: 1;
    border-radius: 14px;
}

h3 {
    margin-bottom: 30px;
}

.words {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    grid-gap: 20px;
    font-size: 1rem;
    margin-bottom: 30px;
}

.mnemonic_in {
    display: flex;
    flex-direction: row;
    align-items: center;
    border-bottom: 1px solid main.$primary-color-light;
    outline: none;

    p {
        margin: 0 5px 0 0 !important;
        color: main.$primary-color-light;
    }

    input {
        color: var(--primary-color);
        background-color: transparent;
        font-weight: 700;
        margin: 0;
        border: none;
        width: 40px;
        flex-grow: 1;

        &[disabled] {
            outline: none;
            pointer-events: none;
            opacity: 0.6;
        }
    }
}

.but_primary {
    width: 80%;
    margin: 0px auto;
    padding: 8px 30px;
}

.err {
    height: 60px;
    margin: 0px auto;
    text-align: left;
    color: var(--error);
}

@include main.mobile-device {
    .mnemonic-body {
        width: 100%;
    }

    .words {
        font-size: 0.8rem;
        grid-gap: 14px;
    }
}
</style>
