import { defineStore } from 'pinia'
import { ref } from 'vue'
import { Notification, NotificationInput } from '@/types'

export const useNotificationsStore = defineStore('notifications', () => {
    // State
    const items = ref<Notification[]>([])

    // Actions
    const add = (data: NotificationInput) => {
        const colorMap: Record<string, string> = {
            'error': '#f44336',
            'warning': '#ff9800',
            'info': '#2196f3',
            'success': '#4caf50',
        }

        const item: Notification = {
            title: data.title,
            message: data.message,
            color: data.color || colorMap[data.type || 'info'] || '#2196f3',
            id: Date.now() + Math.random(), // Simple ID generation
            duration: data.duration || 5000,
        }
        
        items.value.push(item)

        // Auto remove after 5 seconds
        setTimeout(() => {
            remove(item.id)
        }, 5000)

        return item.id
    }

    const remove = (id: number | string) => {
        const index = items.value.findIndex((item) => item.id === id)
        if (index > -1) {
            items.value.splice(index, 1)
        }
    }

    return {
        // State
        items,
        
        // Actions
        add,
        remove,
    }
})