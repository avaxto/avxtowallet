<template>
    <transition name="slide-up">
        <div v-if="showBanner" class="cookie_consent">
            <p>
                We use cookies to improve your experience. By continuing to use this site you
                consent to our use of cookies.
            </p>
            <div class="cookie_actions">
                <button class="accept_btn" @click="accept">Accept</button>
                <button class="reject_btn" @click="reject">Reject</button>
            </div>
        </div>
    </transition>
</template>

<script lang="ts">
import { defineComponent, computed } from 'vue'
import { useMainStore } from '@/stores'

export default defineComponent({
    name: 'CookieConsent',
    setup() {
        const mainStore = useMainStore()

        const showBanner = computed(() => mainStore.cookiesAccepted === null)

        const accept = () => mainStore.acceptCookies()
        const reject = () => mainStore.rejectCookies()

        return { showBanner, accept, reject }
    },
})
</script>

<style scoped lang="scss">
.cookie_consent {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
    padding: 16px 30px;
    background-color: var(--bg-light);
    border-top: 1px solid var(--bg-light);
    box-shadow: 0 -2px 12px rgba(0, 0, 0, 0.15);

    p {
        margin: 0;
        font-size: 13px;
        color: var(--primary-color);
    }
}

.cookie_actions {
    display: flex;
    gap: 10px;
    flex-shrink: 0;
}

.accept_btn,
.reject_btn {
    padding: 8px 20px;
    border: none;
    border-radius: 4px;
    font-size: 13px;
    cursor: pointer;
    white-space: nowrap;
}

.accept_btn {
    background-color: var(--secondary-color);
    color: #fff;
}

.reject_btn {
    background-color: transparent;
    border: 1px solid var(--primary-color-light);
    color: var(--primary-color);
}

.slide-up-enter-active,
.slide-up-leave-active {
    transition: transform 0.35s ease, opacity 0.35s ease;
}

.slide-up-enter-from,
.slide-up-leave-to {
    transform: translateY(100%);
    opacity: 0;
}

@media only screen and (max-width: 600px) {
    .cookie_consent {
        flex-direction: column;
        text-align: center;
        padding: 14px 16px;
    }
}
</style>
