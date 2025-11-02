import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";


// Set version environment variable
process.env.VITE_APP_VERSION = 0.01

export default defineConfig({
  plugins: [
    vue({
      template: {
        compilerOptions: {
          compatConfig: {
            MODE: 2, // Vue 2 compat mode - necessary when using @vue/compat
            RENDER_FUNCTION: false,
            COMPONENT_FUNCTIONAL: 'suppress-warning'
          }
        }
      }
    }),
    // Node.js polyfills for browser compatibility
    nodePolyfills({
      include: ['buffer', 'process', 'util', 'crypto', 'stream', 'http', 'https', 'os', 'vm'],
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
    }),
    wasm(),
    topLevelAwait()
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      // Vue 3 compatibility
      'vue': '@vue/compat',
      // Ledger aliases from vue.config.js
      '@ledgerhq/cryptoassets-evm-signatures/data/evm': '@ledgerhq/cryptoassets-evm-signatures/lib-es/data/evm',
      '@ledgerhq/cryptoassets-evm-signatures/data/eip712': '@ledgerhq/cryptoassets-evm-signatures/lib-es/data/eip712',
      '@ledgerhq/cryptoassets-evm-signatures/data/eip712_v2': '@ledgerhq/cryptoassets-evm-signatures/lib-es/data/eip712_v2',
      '@ledgerhq/domain-service/signers': '@ledgerhq/domain-service/lib-es/signers',
      '@ledgerhq/evm-tools/message/EIP712': '@ledgerhq/evm-tools/lib-es/message/EIP712',
      '@ledgerhq/evm-tools/message': '@ledgerhq/evm-tools/lib-es/message',
      '@ledgerhq/evm-tools/selectors': '@ledgerhq/evm-tools/lib-es/selectors',
    },
  },
  define: {
    global: 'globalThis',
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {          
          vendor: ['vue', 'vue-router', 'pinia', 'vuetify'],
          crypto: ['crypto-browserify', 'buffer', 'stream-browserify', 'ethers', 'web3'],
          avalanche: ['avalanche', '@avalabs/avalanche-wallet-sdk'],
          ledger: ['@ledgerhq/hw-app-eth', '@ledgerhq/hw-transport', '@ledgerhq/hw-transport-webhid', '@ledgerhq/hw-transport-webusb'],
        },
      },
    },
  },
  server: {
    port: 5000,
    // Option 1: Disable HTTPS (current setting)
    https: false, 
    
    // Option 2: Enable HTTPS with basic self-signed cert (uncomment if needed)
    // https: true,
    
    // Option 3: Use custom certificates (uncomment and provide paths if needed)
    // https: {
    //   key: resolve(__dirname, 'server.key'),
    //   cert: resolve(__dirname, 'server.crt'),
    // },
    
    host: true, // Allow external connections
  },
  preview: {
    port: 5000,
    https: false,
  },
  optimizeDeps: {
    include: [
      'vue',
      'vue-router',
      'pinia',
      '@vue/compat',
      'vuetify',
      'bootstrap-vue-next',
      '@unhead/vue',
    ],
    // Force optimization for problematic packages
    force: true,
  },
  css: {
    preprocessorOptions: {
      scss: {
        // Suppress deprecation warnings similar to vue.config.js
        quietDeps: true,
        logger: {
          warn: function(message) {
            // Suppress legacy-js-api warnings
            if (message.includes('legacy-js-api')) {
              return;
            }
            console.warn(message);
          }
        }
      }
    }
  },
})