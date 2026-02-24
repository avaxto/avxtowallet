<template>
    <div class="access_card">
        <div class="content">
            <h1>{{ $t('keystore.title') }}</h1>
            <file-input class="file_in" @change="onfile"></file-input>
            <form @submit.prevent="access">
                <v-text-field
                    class="pass"
                    :label="$t('password')"
                    dense
                    solo
                    flat
                    type="password"
                    v-model="pass"
                    v-if="file"
                    hide-details
                ></v-text-field>
                <p class="err">{{ error }}</p>
                <!--                <remember-key class="remember" v-model="rememberPass" v-if="file" @is-valid="isRememberValid"></remember-key>-->
                <v-btn
                    class="ava_button button_primary"
                    @click="access"
                    :loading="isLoading"
                    v-if="file"
                    :disabled="!canSubmit"
                    depressed
                >
                    {{ $t('access.mnemonic.submit') }}
                </v-btn>
            </form>
            <router-link to="/access" class="link">{{ $t('access.cancel') }}</router-link>
        </div>
    </div>
</template>
<script lang="ts">
import { defineComponent, ref, computed } from 'vue'
import { useMainStore } from '@/stores'
import { useI18n } from 'vue-i18n'

import FileInput from '../../components/misc/FileInput.vue'
// import RememberKey from "../../components/misc/RememberKey.vue";
import { ImportKeyfileInput } from '@/types'
import { AllKeyFileTypes } from '@/js/IKeystore'

export default defineComponent({
    name: 'Keystore',
    components: {
        // RememberKey,
        FileInput,
    },
    setup() {
        const mainStore = useMainStore()
        const { t } = useI18n()
        
        const pass = ref<string>('')
        const file = ref<File | null>(null)
        const fileText = ref<string | null>(null)
        const isLoading = ref<boolean>(false)
        const error = ref<string>('')

        const canSubmit = computed((): boolean => {
            if (!file.value || !pass.value || !fileText.value) {
                return false
            }
            return true
        })

        const onfile = (val: File) => {
            file.value = val

            let reader = new FileReader()
            reader.addEventListener('load', async () => {
                let res = reader.result as string
                fileText.value = res
            })
            reader.readAsText(val)
        }

        const access = () => {
            if (!canSubmit.value || isLoading.value) return

            error.value = ''

            let fileData: AllKeyFileTypes
            try {
                fileData = JSON.parse(fileText.value as string)
            } catch (e) {
                error.value = `${t('access.json_error')}`
                return
            }

            // let rememberPass = this.rememberPass;
            let data: ImportKeyfileInput = {
                password: pass.value,
                data: fileData,
            }

            isLoading.value = true

            setTimeout(() => {
                mainStore
                    .importKeyfile(data)
                    .then((res) => {
                        isLoading.value = false

                        // if(rememberPass){
                        //     parent.$store.dispatch('rememberWallets', rememberPass)
                        // }
                    })
                    .catch((err) => {
                        console.log(err)
                        if (err === 'INVALID_PASS') {
                            error.value = t('access.password_error').toString()
                        } else if (err === 'INVALID_VERSION') {
                            error.value = t('access.keystore_error').toString()
                        } else {
                            error.value = err.message
                        }
                        isLoading.value = false
                    })
            }, 200)
        }

        return {
            pass,
            file,
            fileText,
            isLoading,
            error,
            canSubmit,
            onfile,
            access
        }
    }
})
</script>
<style scoped lang="scss">
@use '../../main';

.pass {
    background-color: var(--bg) !important;
}
.ava_button {
    width: 100%;
    margin-bottom: 22px;
}
.access_card {
    /*max-width: 80vw;*/
    background-color: var(--bg-light);
    padding: main.$container-padding;
    width: 100%;
    /*max-width: 240px;*/
    /*max-width: 1000px;*/
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    border-radius: 6px;
}

.content {
    width: 340px;
    max-width: 100%;
    margin: 0px auto;
}

h1 {
    font-size: main.$m-size;
    font-weight: 400;
}

.file_in {
    margin: 30px auto 10px;
    font-size: 13px;
    border: none !important;
    background-color: var(--bg) !important;
    /*min-width: 200px*/
}

a {
    color: main.$primary-color-light !important;
    text-decoration: underline !important;
    margin: 10px 0 20px;
}

.link {
    color: var(--secondary-color);
}

.remember {
    margin: 12px 0;
}
.err {
    font-size: 13px;
    color: var(--error);
    margin: 14px 0px !important;
}

@media only screen and (max-width: main.$mobile_width) {
    h1 {
        font-size: main.$m-size-mobile;
    }

    .but_primary {
        width: 100%;
    }
}
</style>
