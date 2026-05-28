import axios, { AxiosInstance } from 'axios'
import { handleThrottleResponse } from '@/providers/rate_limiter'

const wallet_api: AxiosInstance = axios.create({
    baseURL: '/api',
    withCredentials: false,
    headers: {
        'Content-Type': 'application/json',
    },
})

// Add response interceptor to handle errors gracefully
wallet_api.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response) {
            const status = error.response.status
            const url = error.config?.url || 'unknown'
            
            if (status === 401) {
                console.warn(`[Wallet API] 401 Unauthorized error for ${url}`)
            } else if (status === 429 || status === 503) {
                handleThrottleResponse(status, error.response?.headers?.['retry-after'])
                console.warn(`[Wallet API] HTTP ${status} for ${url} — traffic paused.`)
            } else if (status >= 500) {
                console.error(`[Wallet API] Server error (${status}) for ${url}`)
            }
        }
        return Promise.reject(error)
    }
)

export { wallet_api }
