<template>
    <div class="custom_network">
        <form @submit.prevent="submit">
            <div>
                <label>{{ $t('network.custom_page.label1') }}</label>
                <input
                    type="text"
                    placeholder="Network Name"
                    v-model="name"
                    data-cy="custom-network-name"
                />
            </div>
            <div>
                <label>URL</label>
                <input
                    data-cy="custom-network-url"
                    type="text"
                    placeholder="http://localhost:9650"
                    v-model="url"
                    @input="checkUrl"
                />
                <p class="form_error" v-if="err_url">{{ err_url }}</p>
            </div>
            <div>
                <label>{{ $t('network.custom_page.label2') }}</label>
                <input
                    type="text"
                    placeholder="www"
                    v-model="explorer_api"
                    @input="cleanExplorerUrl"
                />
            </div>
            <div>
                <label>{{ $t('network.custom_page.label3') }}</label>
                <input
                    type="text"
                    placeholder="www"
                    v-model="explorer_site"
                    @input="cleanExplorerSite"
                />
            </div>
            <p v-if="err" class="form_error">{{ err }}</p>
            <v-btn
                data-cy="custom-network-add"
                :loading="isAjax"
                height="26"
                depressed
                type="submit"
                class="button_primary"
            >
                {{ $t('network.add') }}
            </v-btn>
        </form>
    </div>
</template>
<script lang="ts">
import 'reflect-metadata'
import { defineComponent, ref } from 'vue'

import { AvaNetwork } from '@/js/AvaNetwork'
import axios from 'axios'
import punycode from 'punycode'

export default defineComponent({
    name: 'CustomPage',
    emits: ['add'],
    setup(props, { emit }) {
        const name = ref<string>('My Custom Network')
        const url = ref<string>('')
        const explorer_api = ref<string>('')
        const explorer_site = ref<string>('')
        const err = ref<null | string>(null)
        const err_url = ref<string>('')
        const isAjax = ref<boolean>(false)

        const cleanExplorerUrl = () => {
            let urlVal = explorer_api.value
            urlVal = punycode.toASCII(urlVal)
            explorer_api.value = urlVal
        }

        const cleanExplorerSite = () => {
            let urlVal = explorer_site.value
            urlVal = punycode.toASCII(urlVal)
            explorer_site.value = urlVal
        }

        const checkUrl = () => {
            let urlVal = url.value
            // protect against homograph attack: https://hethical.io/homograph-attack-using-internationalized-domain-name/

            urlVal = punycode.toASCII(urlVal)
            url.value = urlVal

            // must contain http / https prefix
            if (urlVal.substr(0, 7) !== 'http://' && urlVal.substr(0, 8) !== 'https://') {
                err_url.value = 'URLs require the appropriate HTTP/HTTPS prefix.'
                return false
            }

            let split = urlVal.split('://')
            let rest = split[1]

            // must have base ip
            if (rest.length === 0) {
                err_url.value = 'Invalid URL.'
                return false
            }

            // Must have port
            if (!rest.includes(':')) {
                err_url.value = 'You must specify the port of the url.'
                return false
            }

            // Port must be number
            let urlSplit = rest.split(':')
            if (urlSplit.length === 0) {
                err_url.value = 'Invalid port.'
                return false
            }

            let port = parseInt(urlSplit[1])

            if (isNaN(port)) {
                err_url.value = 'Invalid port.'
                return false
            }

            err_url.value = ''
            return true
        }

        const errCheck = () => {
            let error = null

            // check for HTTP HTTPS on url
            let urlVal = url.value

            if (urlVal.substr(0, 7) !== 'http://' && urlVal.substr(0, 8) !== 'https://') {
                error = 'URLs require the appropriate HTTP/HTTPS prefix.'
            }

            if (!name.value) error = 'You must give the network a name.'
            else if (!url.value) error = 'You must set the URL.'

            return error
        }

        const tryConnection = async (credential = false): Promise<number | null> => {
            try {
                let resp = await axios.post(
                    url.value + '/ext/info',
                    {
                        jsonrpc: '2.0',
                        id: 1,
                        method: 'info.getNetworkID',
                    },
                    {
                        withCredentials: credential,
                    }
                )
                return parseInt(resp.data.result.networkID)
            } catch (error) {
                return null
            }
        }

        const submit = async () => {
            err.value = null
            let error = errCheck()

            if (error) {
                err.value = error
                return
            }

            isAjax.value = true
            let credNum = await tryConnection(true)
            let noCredNum = await tryConnection()
            isAjax.value = false

            let validNetId = credNum || noCredNum

            if (!validNetId) {
                err.value = 'Avalanche Network Not Found'
                return
            }

            let net = new AvaNetwork(
                name.value,
                url.value,
                validNetId,
                explorer_api.value,
                explorer_site.value
            )

            emit('add', net)

            // Clear values
            name.value = 'My Custom Network'
            url.value = ''
        }

        return {
            name,
            url,
            explorer_api,
            explorer_site,
            err,
            err_url,
            isAjax,
            cleanExplorerUrl,
            cleanExplorerSite,
            checkUrl,
            errCheck,
            tryConnection,
            submit
        }
    }
})
</script>
<style scoped lang="scss">
@use '../../main';

.custom_network {
    padding: 0px 15px;
    padding-bottom: 15px;
}

.header {
    border-bottom: 1px solid main.$background-color;
    padding: 10px 15px;
    display: flex;
    h4 {
        flex-grow: 1;
    }

    button {
        font-size: 12px;
        padding: 3px 14px;
        border-radius: 4px;
    }
}

form {
    margin-top: 12px;
    label {
        font-size: 12px;
    }
    > div {
        display: flex;
        flex-direction: column;
        margin-bottom: 5px;
    }
}

input,
select {
    color: var(--primary-color);
    background-color: var(--bg-light);
    border-radius: 4px;
    padding: 6px 6px;
    font-size: 13px;
    outline: none;
}
button {
    margin-top: 10px;
    width: 100%;
    font-size: 12px;
    border-radius: 4px;
}

.v-btn {
    text-transform: none;
    font-size: 12px !important;
    color: var(--bg) !important;
}

.rowGroup {
    display: flex;
    flex-direction: row;
    justify-content: space-between;

    > * {
        margin-right: 5px;

        &:last-of-type {
            margin-right: 0;
        }
    }
}

.form_error {
    font-size: 12px;
    color: #e03737;
}
</style>
