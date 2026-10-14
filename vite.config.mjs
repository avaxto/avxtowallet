import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";
import dedupePackages from "./scripts/vite-dedupe-packages.mjs";
import VueI18nPlugin from '@intlify/unplugin-vue-i18n/vite'
import { execSync } from 'child_process'

// Inject the latest git tag as the app version
let appVersion
try {
  appVersion = execSync('git describe --tags --abbrev=0').toString().trim()
} catch {
  appVersion = 'dev'
}
process.env.VITE_APP_VERSION = appVersion

// Same-origin paths for third-party files whose hosts don't send CORS headers
// to this app. Mirrored in static.json for the production host.
// - Avalanche Bridge settings: CORS is allowlisted to core.app only
//   (see src/bridge/avalancheBridge/provider.ts, SETTINGS_PROXY_PATH).
const corsProxies = {
  '/proxy/avalanche-bridge': {
    target: 'https://avawarden-prod.s3.amazonaws.com',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/proxy\/avalanche-bridge/, ''),
  },
}

export default defineConfig({
  plugins: [
    // Bundle each identical npm package once instead of once per installed
    // copy (about 5 MB of duplicates, and their share of build memory).
    dedupePackages(),
    // Precompiles locale JSON into message resources at build time, instead
    // of vue-i18n's default of JIT-compiling each message with
    // `new Function(...)` the first time it's used at runtime. That runtime
    // path is what a script-src CSP without 'unsafe-eval' blocks.
    //
    // Requires vue-i18n >= 10: this plugin's output format is the composer
    // protocol v10+ understands. It was tried against vue-i18n@9.14.5 first
    // and broke every t()/$t() call ("Unexpected return type in composer")
    // because the plugin does not version-detect and always emits that
    // newer format — hence the vue-i18n upgrade landing alongside this.
    VueI18nPlugin({
      include: [resolve(__dirname, './src/locales/**/*.json')],
    }),
    vue(),
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
      // Vue 3 native
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
    // The gzip-size report compresses every chunk again after the build, only
    // to print sizes; skipping it saves memory and time (see CLAUDE.md limits).
    reportCompressedSize: false,
    rollupOptions: {
      // Rollup's default (1000 files open/transformed at once) spikes memory on
      // this 8 GB machine; a couple in flight is barely slower.
      maxParallelFileOps: 2,
      output: {
        manualChunks: {
          vendor: ['vue', 'vue-router', 'pinia', 'vuetify'],
          crypto: ['crypto-browserify', 'buffer', 'stream-browserify', 'ethers', 'web3'],
          // No `ledger` chunk: the @ledgerhq/* packages have circular
          // internal dependencies (hw-app-eth <-> hw-transport <-> shared
          // @ledgerhq/errors, devices, etc.), and forcing them into an
          // isolated manual chunk broke Rollup's cross-chunk evaluation
          // order — production threw "Cannot access '<name>' before
          // initialization" as soon as the chunk's top-level code ran.
          // Leaving them out of manualChunks lets Rollup's automatic
          // splitting place them, which does respect the dependency graph.
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
    proxy: corsProxies,
  },
  preview: {
    port: 5000,
    https: false,
    proxy: corsProxies,
  },
  optimizeDeps: {
    include: [
      'vue',
      'vue-router',
      'pinia',
      'vuetify',
      'bootstrap-vue-next',
      '@unhead/vue',
    ],
    exclude: [
      // Wallet scripting's QuickJS engine finds its .wasm next to its own
      // module (new URL(..., import.meta.url)); pre-bundling would move the
      // module into .vite/deps without the .wasm and break it in dev.
      '@jitl/quickjs-wasmfile-release-sync',
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