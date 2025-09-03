process.env.VUE_APP_VERSION = process.env.npm_package_version

const { defineConfig } = require('@vue/cli-service')
const { VuetifyPlugin } = require('webpack-plugin-vuetify')

module.exports = defineConfig({
    productionSourceMap: false,
    parallel: false,
    publicPath: './',
    chainWebpack: config => {
        // Vue 3 compatibility
        config.resolve.alias.set('vue', '@vue/compat')
        
        // Vue compatibility mode for loader
        config.module
            .rule('vue')
            .use('vue-loader')
            .tap((options) => {
                return {
                    ...options,
                    compilerOptions: {
                        compatConfig: {
                            MODE: 2
                        }
                    }
                }
            })
        
        // Disable TypeScript type checking during build to avoid template literal type errors
        config.plugins.delete('fork-ts-checker')
        
        // Disable ESLint plugin to avoid version conflicts
        config.plugins.delete('eslint')
        
        // Configure CSS loader to handle public assets
        config.module
            .rule('scss')
            .oneOf('vue')
            .use('css-loader')
            .tap(options => {
                options.url = {
                    filter: (url) => {
                        // Handle public folder assets
                        if (url.startsWith('/img/')) {
                            return false; // Let webpack handle it as is
                        }
                        return true;
                    }
                };
                return options;
            })
    },
    transpileDependencies: [
        'vuetify', 
        '@ledgerhq/errors', 
        '@ledgerhq/hw-app-eth', 
        '@ledgerhq/logs',
        '@avalabs/hw-app-avalanche',
        '@ledgerhq/evm-tools'
    ],
    devServer: {
        /**
         * For e2e testing we turn this off using vue cli --mode e2e
         * @link https://cli.vuejs.org/guide/mode-and-env.html#modes
         */
        https: !process.env.USE_HTTP,
        port: 5000,
    },
    configureWebpack: {
        plugins: [
            new VuetifyPlugin()
        ],
        optimization: {
            splitChunks: {
                chunks: 'all',
                minSize: 600 * 1000,
                maxSize: 2000 * 1000,
            },
        },
        resolve: {
            symlinks: false,
            alias: {
                '@ledgerhq/cryptoassets-evm-signatures/data/evm': '@ledgerhq/cryptoassets-evm-signatures/lib-es/data/evm',
                '@ledgerhq/cryptoassets-evm-signatures/data/eip712': '@ledgerhq/cryptoassets-evm-signatures/lib-es/data/eip712',
                '@ledgerhq/cryptoassets-evm-signatures/data/eip712_v2': '@ledgerhq/cryptoassets-evm-signatures/lib-es/data/eip712_v2',
                '@ledgerhq/domain-service/signers': '@ledgerhq/domain-service/lib-es/signers',
                '@ledgerhq/evm-tools/message/EIP712': '@ledgerhq/evm-tools/lib-es/message/EIP712',
                '@ledgerhq/evm-tools/message': '@ledgerhq/evm-tools/lib-es/message',
                '@ledgerhq/evm-tools/selectors': '@ledgerhq/evm-tools/lib-es/selectors',
            },
            fallback: {
                crypto: require.resolve('crypto-browserify'),
                stream: require.resolve('stream-browserify'),
                http: require.resolve('stream-http'),
                https: require.resolve('https-browserify'),
                os: require.resolve('os-browserify/browser'),
                vm: require.resolve('vm-browserify')
            }
        },
    },
    pwa: {
        name: 'AVAX Wallet',
        manifestOptions: {
            start_url: '/',
        },
        iconPaths: {
            favicon16: 'img/icons/favicon-16x16.png',
            favicon32: 'img/icons/favicon-32x32.png',
            appleTouchIcon: 'img/icons/apple-touch-icon.png',
            maskIcon: 'img/icons/favicon-32x32.png',
            msTileImage: 'img/icons/mstile-150x150.png',
        },
    },
})
