<template>
    <div class="access_card">
        <div class="content">
            <Identicon :value="account.baseAddresses.join('')"></Identicon>
            <h1>{{ account.name }}</h1>
            <form @submit.prevent="access">
                <input
                    class="single_line_input hover_border pass"
                    type="password"
                    placeholder="Password"
                    v-model="password"
                />
                <p class="err">{{ error }}</p>
                <v-btn
                    class="ava_button button_primary"
                    @click="access"
                    :loading="isLoading"
                    :disabled="!canSubmit"
                    depressed
                >
                    Access Wallet
                </v-btn>
                <small>{{ $t('keys.account_slow_warning') }}</small>
                <br />
                <br />
            </form>
            <router-link to="/access" class="link">Cancel</router-link>
        </div>
    </div>
</template>
<script lang="ts">
import { defineComponent, ref, computed, onMounted } from 'vue'
import { useStore } from '@/stores'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ImportKeyfileInput, iUserAccountEncrypted } from '@/store/types'
import Identicon from '@/components/misc/Identicon.vue'

export default defineComponent({
    name: 'Account',
    components: { Identicon },
    setup() {
        const store = useStore()
        const route = useRoute()
        const router = useRouter()
        const { t } = useI18n()

        const password = ref('')
        const isLoading = ref(false)
        const error = ref('')

        const index = computed(() => {
            return route.params.index
        })

        const accounts = computed(() => {
            return store.state.Accounts.accounts
        })

        const account = computed(() => {
            return accounts.value[index.value as any]
        })

        const access = async () => {
            const accountVal = account.value
            if (!canSubmit.value || isLoading.value) return
            if (accountVal == null) return

            error.value = ''
            isLoading.value = true
            let data: ImportKeyfileInput = {
                password: password.value,
                data: accountVal.wallet,
            }

            setTimeout(() => {
                store
                    .dispatch('Accounts/accessAccount', {
                        index: index.value,
                        pass: password.value,
                    })
                    .then((res) => {
                        isLoading.value = false
                    })
                    .catch((err) => {
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

        const onsuccess = () => {
            isLoading.value = false
            password.value = ''
        }

        const onerror = (e: any) => {
            error.value = e
            password.value = ''
            isLoading.value = false
        }

        const canSubmit = computed((): boolean => {
            if (!password.value) {
                return false
            }
            return true
        })

        onMounted(() => {
            if (!account.value) {
                router.replace('/access')
                return
            }
        })

        return {
            password,
            isLoading,
            error,
            index,
            accounts,
            account,
            access,
            onsuccess,
            onerror,
            canSubmit
        }
    }
})
</script>
<style scoped lang="scss">
@use '../../main';
.pass {
    text-align: center;
    background-color: var(--bg-light) !important;
}
.ava_button {
    width: 100%;
    margin-bottom: 22px;
}
.access_card {
    /*max-width: 80vw;*/
    //background-color: var(--bg-light);
    //padding: main.$container-padding;
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

form {
    margin: 14px 0;
}
.file_in {
    margin: 30px auto 10px;
    font-size: 13px;
    border: none !important;
    background-color: var(--bg-light) !important;
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
