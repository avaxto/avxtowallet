/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
*/
/**
 * Jest configuration.
 *
 * This config had rotted to the point where `yarn test` could not start at all:
 * it named `vue-jest` and `babel-jest`, neither of which was a dependency, and
 * babel.config.js reached for a Vue CLI preset that has never been installed
 * here (this is a Vite project, not a Vue CLI one). Every test in `tests/` was
 * therefore unrunnable — which is how several of them drifted out of sync with
 * the code they cover without anyone noticing.
 *
 * Notes on the pieces that are not obvious:
 *
 *  - `@vue/vue3-jest`, not `vue-jest`. The latter compiles Vue 2 SFCs.
 *  - `transformIgnorePatterns` deliberately un-ignores a few dependencies.
 *    Jest does not transform `node_modules`, which is right for almost all of
 *    them, but these ship ES modules that fail on their first `export`.
 *  - `customExportConditions` is `node` alone, replacing jsdom's `browser`.
 *    Browser builds here are ESM, or WASM loaders that cannot initialise.
 *  - `@/avxto/buildEnv` is mapped to a stub: it is the one module that reads
 *    `import.meta`, a syntax error once compiled to CommonJS. See that file.
 */
module.exports = {
    moduleFileExtensions: ['js', 'mjs', 'cjs', 'ts', 'json', 'vue'],
    transform: {
        '^.+\\.vue$': '@vue/vue3-jest',
        '^.+\\.tsx?$': [
            'ts-jest',
            {
                tsconfig: '<rootDir>/tsconfig.jest.json',
                // Type errors are reported but do not fail the run. Type
                // checking belongs to `tsc -p tsconfig.typecheck.json`, which
                // currently counts ~245 pre-existing errors, most of them in
                // the vendored SDKs under src/avalanche* — third-party code
                // this project does not maintain. Gating the suite on that
                // would mean no test could ever pass, and would tie the health
                // of the tests to unrelated vendored code.
                diagnostics: { warnOnly: true },
            },
        ],
        '^.+\\.(m|c)?jsx?$': 'babel-jest',
    },
    moduleNameMapper: {
        // Vite resolves asset imports to URLs; Jest cannot parse the binary,
        // so anything importing an image (e.g. avxto/AVXTOConf) would fail to
        // load. Must precede the '@/' rule — first match wins.
        '\\.(png|jpe?g|gif|svg|webp|avif|ico)$': '<rootDir>/tests/assetStub.js',
        '\\.(css|scss|sass)$': '<rootDir>/tests/styleStub.js',
        // Vite-only build-time values. Also before the '@/' rule.
        '^@/avxto/buildEnv$': '<rootDir>/tests/stubs/buildEnv.ts',
        '^@/(.*)$': '<rootDir>/src/$1',
    },
    // Dependencies that ship ES modules only, so Jest must transform them
    // rather than requiring them as-is. Everything else in node_modules is
    // left alone, which is both correct and much faster.
    transformIgnorePatterns: [
        '/node_modules/(?!(' +
            [
                '@avalanche-sdk',
                '@avalabs',
                'uint8array-tools',
                'unhead',
                '@unhead',
                'hookable',
                'vue3-virtual-scroll-list',
            ].join('|') +
            ')/)',
    ],
    testEnvironment: '<rootDir>/tests/jsdomEnvironment.js',
    testEnvironmentOptions: {
        url: 'https://localhost/',
        // `node` ALONE, replacing jsdom's default of `browser`. Note this is a
        // set, not a preference order: a package's own `exports` map decides
        // which of the active conditions wins by the order its keys are
        // written, so listing both would still let `browser` beat `node` in
        // any package that happens to declare it first.
        //
        // Browser builds are the wrong ones here in two different ways.
        // tiny-secp256k1's is ESM around a WASM loader that cannot initialise
        // in this environment, and it fails far from the cause — as
        // `ecc library invalid` thrown by ECPairFactory. vue-i18n's is plain
        // ESM, which Jest cannot require at all. Both ship CommonJS under
        // `node`. Packages declaring no `node` condition still resolve through
        // `default`.
        customExportConditions: ['node'],
    },
    testRegex: '(/__tests__/.*|(\\.|/)(test|spec))\\.(jsx?|tsx?)$',
}
