<template>
    <div class="sel_locale">        
        <select v-model="locale">
            <option v-for="item in items" :key="item.code" :value="item.code">
                {{ item.nativeName }}
            </option>
        </select>
    </div>
</template>
<script lang="ts">
import { defineComponent, ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'

//@ts-ignore
import langMap from '@/locales/lang_map'

import { LanguageItem } from '@/components/misc/LanguageSelect/types'

interface FLAG_DICT {
    [key: string]: string
}
const FLAGS_OVERRIDE: FLAG_DICT = {
    en: 'us',
    zh_hant: 'cn',
    zh_hans: 'cn',
    cs: 'cz',
    ca: 'es-ca',
    uk: 'ua',
    af: 'za',
    ar: 'ae',
    da: 'dk',
    el: 'gr',
    he: 'il',
    nb: 'no',
    sr: 'rs',
    sv: 'se',
    ja: 'jp',
}

export default defineComponent({
    name: 'LanguageSelect',
    components: {
        
    },
    setup() {
        const { locale: i18nLocale, messages } = useI18n()
        const locale = ref('en')

        onMounted(() => {
            locale.value = i18nLocale.value
        })

        watch(locale, (val: string) => {
            i18nLocale.value = val
            localStorage.setItem('lang', val)
        })

        const flag = computed(() => {
            let selCode = locale.value

            if (FLAGS_OVERRIDE[selCode]) {
                return FLAGS_OVERRIDE[selCode]
            } else {
                return selCode
            }
        })

        const items = computed((): LanguageItem[] => {
            let res = []

            for (var langCode in messages.value) {
                let data = langMap[langCode]

                res.push({
                    code: langCode,
                    name: data.name,
                    nativeName: data.nativeName,
                })
            }
            return res
        })

        return {
            locale,
            flag,
            items
        }
    }
})
</script>
<style scoped lang="scss">
.sel_locale {
    display: flex;
    flex-direction: row;
    align-items: center;
    padding: 4px 12px;
    border: 1px solid transparent;
    border-radius: 3px;
    position: relative;
    overflow: hidden;

    &:hover {
        opacity: 0.5;
    }
}

.flag {
    flex-shrink: 0;
}
.sel_locale p.selected {
    margin: 0;
    padding-left: 8px;
    color: var(--primary-color);
}

.sel_outlined {
    border-color: #1d82bb !important;
    color: #1d82bb !important;
}

.selected {
    //font-size: 13px;
}

select {
    outline: none;
    flex-grow: 1;
    margin-left: 10px;
    color: var(--primary-color);
    cursor: pointer;
    //font-size: 13px;

    &:hover {
        color: var(--primary-color);
    }
}

@media only screen and (max-width: 600px) {
    .sel_locale {
        width: min-content;
    }
    p.selected {
        display: none;
    }
}
</style>
<style lang="scss">
.sel_locale {
    .vs__dropdown-toggle {
        border-color: var(--primary-color-light) !important;
    }
}
</style>
