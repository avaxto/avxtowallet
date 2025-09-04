<template>
    <modal ref="modal" :title="title" class="modal_parent" icy>
        <div class="mnemonic_body">
            <div class="">
                <div v-for="(q, i) in questions" :key="q.words[0]" class="question_row">
                    <p>Select word {{ q.questionIndex + 1 }}</p>
                    <div style="display: flex; justify-content: center">
                        <RadioButtons
                            style="margin: 0px auto"
                            :labels="q.words"
                            :keys="q.words"
                            v-model="answers[i]"
                        ></RadioButtons>
                    </div>
                </div>
            </div>
            <p class="err">{{ err }}</p>
            <button class="but_primary ava_button button_primary" @click="verify">Verify</button>
        </div>
    </modal>
</template>

<script lang="ts">
import { defineComponent, ref, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'

import Modal from '@/components/modals/Modal.vue'
import MnemonicPhrase from '@/js/wallets/MnemonicPhrase'
import RadioButtons from '@/components/misc/RadioButtons.vue'
import { getRandomMnemonicWord } from '@/helpers/getRandomMnemonicWord'

interface Question {
    words: [string, string, string]
    questionIndex: number // Which index are we asking the user to verify
    answerIndex: number // Which word is the correct option out of the 3
}

export default defineComponent({
    name: 'VerifyMnemonic2',
    components: {
        RadioButtons,
        Modal,
    },
    props: {
        mnemonic: {
            type: MnemonicPhrase,
            required: true
        }
    },
    emits: ['complete'],
    setup(props, { emit }) {
        const { t } = useI18n()
        const modal = ref<InstanceType<typeof Modal> | null>(null)
        const isActive = ref(false)
        const keysIn = ref<string[]>([])
        const hiddenIndices = ref<number[]>([])
        const err = ref('')
        const title = ref('')
        const answers = ref<(string | undefined)[]>([undefined, undefined, undefined])
        const questions = ref<Question[]>([])

        const init = () => {
            const wordsLen = 24
            keysIn.value = Array(wordsLen).join('.').split('.')

            // Hide 4 words
            const qNum = 3
            const usedIndex: number[] = []
            const newQuestions: Question[] = []
            const mnemonic = props.mnemonic.getValue().split(' ')

            while (newQuestions.length < qNum) {
                const randIndex = Math.floor(Math.random() * (wordsLen - 1))

                if (!usedIndex.includes(randIndex)) {
                    usedIndex.push(randIndex)
                    const w0 = mnemonic[randIndex]
                    // Select 2 more words
                    const w1 = getRandomMnemonicWord()
                    const w2 = getRandomMnemonicWord()

                    let words: [string, string, string] = [w0, w1, w2]
                    // Rotate until w0 is at answer index
                    const answerIndex = Math.round(Math.random() * 2)
                    // Shift right answerIndex times
                    for (let i = 0; i < answerIndex; i++) {
                        const temp = words.pop() as string
                        words.splice(0, 0, temp)
                    }

                    newQuestions.push({
                        words: words,
                        questionIndex: randIndex,
                        answerIndex: answerIndex,
                    })
                }
            }

            questions.value = newQuestions
        }

        const open = () => {
            modal.value?.open()
            err.value = ''
            answers.value = [undefined, undefined, undefined]
        }

        const close = () => {
            isActive.value = false
            err.value = ''
        }

        const formCheck = () => {
            err.value = ''

            for (let i = 0; i < questions.value.length; i++) {
                const question = questions.value[i]
                const answer = answers.value[i]

                if (question.words[question.answerIndex] != answer) {
                    err.value = 'You selected the wrong words.'
                    return false
                }
            }

            return true
        }

        const verify = () => {
            if (!formCheck()) return
            modal.value?.close()
            emit('complete')
        }

        // Watch mnemonic prop for changes
        watch(() => props.mnemonic, (val: MnemonicPhrase) => {
            init()
        })

        onMounted(() => {
            init()
            title.value = t('create.verifytitle')
        })

        return {
            modal,
            isActive,
            keysIn,
            hiddenIndices,
            err,
            title,
            answers,
            questions,
            open,
            close,
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

.but_primary {
    width: 80%;
    margin: 0px auto;
    padding: 8px 30px;
}

.err {
    height: 60px;
    margin: 0px auto;
    text-align: center;
    color: var(--error);
}

.question_row {
    margin-bottom: 14px;
}
</style>
