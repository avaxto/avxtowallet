<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<template>
    <div class="earn_rewards_view">
        <div class="head">
            <h1>{{ $t('earn.rewards_card.title') }}</h1>
            <p>{{ $t('earn.rewards_card.desc') }}</p>
            <router-link to="/wallet/earn" class="back_link">
                <fa icon="arrow-left"></fa>
                {{ $t('earn.title') }}
            </router-link>
        </div>
        <UserRewards></UserRewards>
    </div>
</template>
<script lang="ts">
import { defineComponent } from 'vue'

import UserRewards from '@/components/wallet/earn/UserRewards.vue'

export default defineComponent({
    name: 'EarnRewards',
    components: {
        UserRewards,
    },
})
</script>
<style scoped lang="scss">
@use '../../main';

.earn_rewards_view {
    height: auto;
    min-height: 100%;
    overflow: visible;
}

h1 {
    font-weight: normal;
}

.head {
    margin-bottom: 24px;
}

.back_link {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-top: 10px;
    font-size: 13px;
    color: var(--primary-color-light);

    &:hover {
        color: var(--primary-color);
    }
}
</style>
