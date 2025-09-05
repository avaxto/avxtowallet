<template>
    <div class="custom_network">
        <form @submit.prevent="">
            <div>
                <label>Network Name</label>
                <input type="text" placeholder="Network Name" v-model="name" />
            </div>
            <div>
                <label>URL</label>
                <input
                    type="text"
                    placeholder="http://localhost:9650"
                    v-model="url"
                    @input="checkUrl"
                />
                <p class="form_error" v-if="err_url">{{ err_url }}</p>
            </div>
            <div>
                <label>Explorer API (optional)</label>
                <input
                    type="text"
                    placeholder="www"
                    v-model="explorer_api"
                    @input="cleanExplorerUrl"
                />
            </div>
            <div>
                <label>Explorer Site (optional)</label>
                <input
                    type="text"
                    placeholder="www"
                    v-model="explorer_site"
                    @input="cleanExplorerSite"
                />
            </div>
            <div class="rowGroup">
                <div>
                    <label>Network ID</label>
                    <input type="number" placeholder="Network ID" v-model.number="networkId" />
                </div>
            </div>
            <p v-if="err" class="form_error">{{ err }}</p>
            <button @click="saveNetwork" class="button_primary">Save Changes</button>
            <!--            <button @click="deleteNetwork" class="del_button">Delete Network</button>-->
        </form>
    </div>
</template>
<script lang="ts">
import 'reflect-metadata'
import { defineComponent, ref, onMounted } from 'vue'
import { useStore } from 'vuex'

import { AvaNetwork } from '@/js/AvaNetwork'
import punycode from 'punycode'

interface Props {
    net: AvaNetwork
}

export default defineComponent({
    name: 'EditPage',
    props: {
        net: {
            type: Object as () => AvaNetwork,
            required: true
        }
    },
    emits: ['delete', 'success'],
    setup(props: Props, { emit }) {
        const store = useStore()
        
        const name = ref('My Custom Network')
        const url = ref('')
        const networkId = ref(12345)
        const explorer_api = ref<string | undefined>('')
        const explorer_site = ref<string | undefined>('')
        const chainId = ref('X')
        const err = ref(null)
        const err_url = ref('')

        const cleanExplorerUrl = () => {
            const urlValue = explorer_api.value as string
            explorer_api.value = punycode.toASCII(urlValue)
        }

        const cleanExplorerSite = () => {
            const urlValue = explorer_site.value as string
            explorer_site.value = punycode.toASCII(urlValue)
        }

        const checkUrl = () => {
            let urlValue = url.value
            // protect against homograph attack: https://hethical.io/homograph-attack-using-internationalized-domain-name/
            urlValue = punycode.toASCII(urlValue)
            url.value = urlValue

            // must contain http / https prefix
            if (urlValue.substr(0, 7) !== 'http://' && urlValue.substr(0, 8) !== 'https://') {
                err_url.value = 'URLs require the appropriate HTTP/HTTPS prefix.'
                return false
            }

            const split = urlValue.split('://')
            const rest = split[1]

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

            const urlSplit = rest.split(':')
            if (urlSplit.length === 0) {
                err_url.value = 'Invalid port.'
                return false
            }

            const port = parseInt(urlSplit[1])

            if (isNaN(port)) {
                err_url.value = 'Invalid port.'
                return false
            }

            err_url.value = ''
            return true
        }

        const errCheck = () => {
            let errValue = null

            // check for HTTP HTTPS on url
            const urlValue = url.value

            if (urlValue.substr(0, 7) !== 'http://' && urlValue.substr(0, 8) !== 'https://') {
                errValue = 'URLs require the appropriate HTTP/HTTPS prefix.'
            }

            if (!name.value) errValue = 'You must give the network a name.'
            else if (!url.value) errValue = 'You must set the URL.'
            else if (!chainId.value) errValue = 'You must set the chain id.'
            else if (!networkId.value) errValue = 'You must set the network id.'

            return errValue
        }

        const deleteNetwork = () => {
            emit('delete')
        }

        const saveNetwork = async () => {
            const net = props.net
            net.name = name.value
            net.updateURL(url.value)
            net.explorerUrl = explorer_api.value
            net.explorerSiteUrl = explorer_site.value
            net.networkId = networkId.value

            await store.dispatch('Network/save')

            store.dispatch('Notifications/add', {
                title: 'Changes Saved',
                message: 'Network settings updated.',
            })

            emit('success')
        }

        onMounted(() => {
            const net = props.net

            name.value = net.name
            url.value = net.getFullURL()
            networkId.value = net.networkId
            explorer_api.value = net.explorerUrl
            explorer_site.value = net.explorerSiteUrl
        })

        return {
            name,
            url,
            networkId,
            explorer_api,
            explorer_site,
            chainId,
            err,
            err_url,
            cleanExplorerUrl,
            cleanExplorerSite,
            checkUrl,
            errCheck,
            deleteNetwork,
            saveNetwork
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
    background-color: var(--bg-light);
    color: var(--primary-color);
    border-radius: 4px;
    padding: 6px 6px;
    font-size: 13px;
    outline: none;
    width: 100%;
}
button {
    margin-top: 10px;
    width: 100%;
    background-color: main.$primary-color;
    color: #fff;
    font-size: 12px;
    padding: 3px 14px;
    border-radius: 4px;
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

    > div {
        width: 100%;
    }
}

.form_error {
    font-size: 12px;
    color: #e03737;
}
</style>
