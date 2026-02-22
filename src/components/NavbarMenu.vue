<template>
    <div class="navbar-menu">
        <v-menu offset-y>
            <template v-slot:activator="{ props }">
                <v-btn text v-bind="props" class="menu-btn">
                    File
                </v-btn>
            </template>
            <v-list>
                <v-list-item @click="handleMenuItemClick('file')">
                    <v-list-item-title>Sample File Item</v-list-item-title>
                </v-list-item>
            </v-list>
        </v-menu>

        <v-menu offset-y>
            <template v-slot:activator="{ props }">
                <v-btn text v-bind="props" class="menu-btn">
                    Wallet
                </v-btn>
            </template>
            <v-list>
                <v-list-item @click="handleMenuItemClick('wallet')">
                    <v-list-item-title>Sample Wallet Item</v-list-item-title>
                </v-list-item>
            </v-list>
        </v-menu>

        <v-menu offset-y>
            <template v-slot:activator="{ props }">
                <v-btn text v-bind="props" class="menu-btn">
                    Toolbox
                </v-btn>
            </template>
            <v-list>
                <v-list-item @click="handleMenuItemClick('toolbox')">
                    <v-list-item-title>Sample Toolbox Item</v-list-item-title>
                </v-list-item>
            </v-list>
        </v-menu>

        <v-menu offset-y>
            <template v-slot:activator="{ props }">
                <v-btn text v-bind="props" class="menu-btn">
                    Help
                </v-btn>
            </template>
            <v-list>
                <v-list-item @click="handleMenuItemClick('help')">
                    <v-list-item-title>Sample Help Item</v-list-item-title>
                </v-list-item>
            </v-list>
        </v-menu>
    </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue'

export default defineComponent({
    name: 'NavbarMenu',
    methods: {
        handleMenuItemClick(menu: string) {
            alert(`Clicked on a sample item in the ${menu} menu!`)
        },
    },
})
</script>

<style scoped lang="scss">
.navbar-menu {
    display: flex;
    align-items: center;
    margin-left: 20px;
}

.menu-btn {
    font-weight: bold;
}
</style>
