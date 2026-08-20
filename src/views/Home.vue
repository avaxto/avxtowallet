<template>
    <div class="home">
        <b-container>
            <b-row>
                <b-col>
                    <div class="home_wrapper">
                        <div class="home_topbar">
                            <AvxtoMenu></AvxtoMenu>
                        </div>

                        <h1 class="homeh1">{{ $t('home.desc') }}</h1>

                        <div class="login_wrapper">
                            <div class="login_option">
                                <header>
                                    <div class="img_container">
                                        <img src="@/assets/diamond-primary-night.svg" alt="" />
                                    </div>
                                    <h2>{{ $t('home.access.title') }}</h2>
                                    <p>{{ $t('home.access.desc') }}</p>
                                </header>
                                <div>
                                    <router-link
                                        data-cy="access"
                                        to="/access"
                                        class="ava_button button_primary submit_but"
                                    >
                                        {{ $t('home.access.submit') }}
                                    </router-link>
                                </div>
                            </div>
                            <div class="login_option">
                                <header>
                                    <div class="img_container">
                                        <img :src="createWalletIconSrc" alt="" />
                                    </div>
                                    <h2>{{ $t('home.create.title') }}</h2>
                                    <p>{{ $t('home.create.desc') }}</p>
                                </header>
                                <div>
                                    <router-link
                                        data-cy="create"
                                        to="/create"
                                        class="ava_button button_secondary submit_but"
                                    >
                                        {{ $t('home.create.submit') }}
                                    </router-link>
                                </div>
                            </div>
                        </div>
                        <ToS class="tos" style="align-self: left; margin: 30px !important"></ToS>
                    </div>
                </b-col>
            </b-row>
        </b-container>
        <CookieConsent></CookieConsent>
    </div>
</template>

<script lang="ts">
import { defineComponent, computed } from 'vue'
import ToS from '@/components/misc/ToS.vue'
import CookieConsent from '@/components/misc/CookieConsent.vue'
import AvxtoMenu from '@/components/AvxtoMenu.vue'
import { useActivePlatformStore } from '@/platforms'
import diamondAvalanche from '@/assets/diamond-secondary-avalanche.svg'
import diamondEvm from '@/assets/diamond-secondary-evm.svg'

export default defineComponent({
    name: 'Home',
    components: { ToS, CookieConsent, AvxtoMenu },
    setup() {
        const platformStore = useActivePlatformStore()

        /**
         * The "Create New Wallet" card's icon used to be one static asset with
         * a pink circle baked into the SVG itself (`diamond-secondary-night.svg`,
         * `fill="#E84970"`) — a plain <img src> reference, so that colour
         * couldn't be retargeted with CSS the way an inline SVG or
         * PlatformLogo.vue can be. Swapping the whole asset per platform is
         * what makes it follow the active platform's colour at all: yellow to
         * match the EVM platform's accent, red instead of the old pink for
         * Avalanche.
         */
        const createWalletIconSrc = computed((): string => {
            return platformStore.activePlatformId === 'evm' ? diamondEvm : diamondAvalanche
        })

        return { createWalletIconSrc }
    },
})
</script>

<style scoped lang="scss">
@use "../main";

.homeh1 {
    margin-left: 0px;
}

// Bootstrap's .container caps out at a max-width per breakpoint (540px up
// to 1320px) — override it so the container spans the full page width
// instead of sitting in a narrower, centered box.
:deep(.container) {
    width: 100%;
    max-width: 100%;
    padding-left: 28px;
}

.home {
    padding-top: 100px;
    /*background-color: #fff;*/
    display: flex;
    justify-content: center;
    align-items: flex-start;
    position: relative;

    a {
        margin: 10px;
        text-align: center;
        display: block;
    }

    .home_wrapper {
        width: 100%;
        display: flex;
        flex-direction: column;
        align-content: center;
        justify-content: center;

        .home_topbar {
            display: flex;
            justify-content: flex-end;
            margin-bottom: 10px;
        }

        .login_wrapper {
            margin-top: 60px;
            display: grid;
            grid-template-columns: 1fr 1fr;
            column-gap: main.$container-padding;

            .login_option {
                display: flex;
                flex-direction: column;
                border-radius: 2px;
                align-items: flex-start;
                justify-content: space-between;
                background-color: var(--bg-light);
                padding: 60px 90px main.$container-padding main.$container-padding;

                header {
                    margin-bottom: 60px;

                    img {
                        width: 89px;
                        height: 89px;
                        max-height: none;
                    }

                    h2 {
                        padding-top: main.$s-size;
                        font-family: 'DM Sans', sans-serif;
                        font-size: main.$s-size;
                        text-transform: uppercase;
                        color: var(--primary-color-light);
                    }

                    p {
                        margin-top: 10px !important;
                        font-size: main.$l-size;
                    }
                }

                a {
                    margin: 0;
                }
            }
        }
    }
}

.tos {
    margin-top: 14px !important;
}

.submit_but {
    width: max-content;
}
/* ==========================================
   Nav
   ========================================== */

@include main.night-mode {
}
.logo {
    margin-bottom: 30px;
}

img {
    max-height: 50px;
    object-fit: contain;
}

@include main.medium-device {
    .login_option {
        padding: 30px 40px !important;
        p {
            font-size: 1.4rem !important;
        }
    }
}

@include main.mobile-device {
    .auth {
        border-radius: 0;
        box-shadow: none;
    }

    .menu_option {
        padding: 5vh 12px;
    }
    .menu_option button {
        width: 100%;
        padding: 8px;
    }

    .imgcover {
        display: none;
    }

    .home {
        .home_wrapper {
            h1 {
                font-size: main.$xl-size-mobile;
            }

            .login_wrapper {
                grid-template-columns: none;
                display: flex;
                flex-direction: column;

                .login_option {
                    margin-bottom: main.$vertical-padding;
                    padding: 30px 15px;
                    align-items: center;

                    header {
                        display: flex;
                        flex-direction: column;
                        align-items: center;

                        margin-bottom: 30px;

                        img {
                            width: 40px;
                            height: 40px;
                        }

                        h2 {
                            padding-top: main.$s-size-mobile;
                            font-size: main.$s-size-mobile;
                        }

                        p {
                            margin-top: 10px !important;
                            font-size: main.$l-size-mobile;
                            text-align: center;
                        }
                    }

                    a {
                        margin: 0;
                    }
                }
            }
        }
    }
}

@media only screen and (max-width: 600px) {
}
</style>
