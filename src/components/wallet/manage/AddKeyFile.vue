<template>
    <div class="add_key_file">
        <label>{{ $t('keystore.title') }}</label>
        <form @submit.prevent="importKeyfile">
            <file-input @change="onfile" class="formIn" ref="fileIn"></file-input>
            <label>{{ $t('keys.export_placeholder1') }}</label>
            <v-text-field
                class="formIn"
                :placeholder="$t('keys.export_placeholder1')"
                dense
                outlined
                hide-details
                type="password"
                v-model="pass"
            ></v-text-field>
            <p v-if="err" class="err">{{ err }}</p>
            <v-btn
                type="submit"
                :loading="isLoading"
                :disabled="!canSubmit"
                class="addKeyBut button_primary ava_button"
                depressed
                block
            >
                {{ $t('keys.import_key_button') }}
            </v-btn>
        </form>
    </div>
</template>
<script lang="ts">
import { defineComponent, ref, computed } from 'vue'
import { useMainStore } from '@/stores'
import FileInput from '@/components/misc/FileInput.vue'
import { ImportKeyfileInput } from '@/types'
import { AllKeyFileTypes } from '@/js/IKeystore'
import { KEYSTORE_VERSION } from '@/js/Keystore'

export default defineComponent({
    name: 'AddKeyFile',
    components: {
        FileInput,
    },
    emits: ['success'],
    setup(props, { emit }) {
        const mainStore = useMainStore()
        const canAdd = ref(false)
        const pass = ref('')
        const keyfile = ref<File | null>(null)
        const isLoading = ref(false)
        const err = ref<string | null>(null)
        const fileText = ref<string | null>(null)
        const fileIn = ref<InstanceType<typeof FileInput>>()

        const canSubmit = computed(() => {
            return keyfile.value && pass.value && fileText.value ? true : false
        })

        const onfile = (val: File) => {
            keyfile.value = val

            let reader = new FileReader()
            reader.addEventListener('load', async () => {
                let res = reader.result as string
                fileText.value = res
            })
            reader.readAsText(val)
        }

        const importKeyfile = () => {
            let fileData: AllKeyFileTypes
            err.value = null

            try {
                fileData = JSON.parse(fileText.value as string)
            } catch (e) {
                err.value = 'Unable to parse JSON file.'
                return
            }

            if (fileData.version != KEYSTORE_VERSION) {
                // TODO: update here?
                err.value =
                    'Tried to import an old keystore version. Please update your keystore file before importing.'
                return
            }

            isLoading.value = true

            setTimeout(async () => {
                let input: ImportKeyfileInput = {
                    password: pass.value,
                    data: fileData,
                }

                try {
                    await mainStore.importKeyfile(input)
                    emit('success')
                    clear()
                } catch (error) {
                    isLoading.value = false
                    if (error === 'INVALID_PASS') {
                        err.value = 'Invalid password.'
                    } else {
                        err.value = 'Failed to read keystore file.'
                    }
                }
            }, 200)
        }

        const clear = () => {
            isLoading.value = false
            pass.value = ''
            keyfile.value = null
            canAdd.value = false
            err.value = null
            if (fileIn.value) {
                fileIn.value.clear()
            }
        }

        return {
            canAdd,
            pass,
            keyfile,
            isLoading,
            err,
            fileText,
            fileIn,
            canSubmit,
            onfile,
            importKeyfile,
            clear
        }
    }
})
</script>
<style lang="scss">
.add_key_file {
    fieldset {
        border: none !important;
    }
}
</style>
<style scoped lang="scss">
@use '../../../main';
.add_key_file {
    padding: 14px 0;
}

.addKeyBut {
    text-transform: none;
    border-radius: 2px;
    margin-top: 14px;
}

label {
    font-size: 12px;
    color: main.$primary-color-light;
}

.err {
    color: var(--error);
    margin: 4px 0px;
    font-size: 12px;
}

.formIn {
    height: 40px;
    font-size: 12px;
    background-color: var(--bg-light) !important;
    border-radius: 2px;
}
</style>
<style lang="scss">
.add_key_file {
    .formIn .v-input__slot {
        background-color: var(--bg-light) !important;
    }
}
</style>
