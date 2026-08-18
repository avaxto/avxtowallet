module.exports = {
    moduleFileExtensions: ['js', 'ts', 'json', 'vue'],
    transform: {
        '.*\\.(vue)$': 'vue-jest',
        '^.+\\.ts?$': 'ts-jest',
        '^.+\\.js?$': 'babel-jest',
    },
    moduleNameMapper: {
        // Vite resolves asset imports to URLs; Jest cannot parse the binary,
        // so anything importing an image (e.g. avxto/AVXTOConf) would fail to
        // load. Must precede the '@/' rule — first match wins.
        '\\.(png|jpe?g|gif|svg|webp|avif|ico)$': '<rootDir>/tests/assetStub.js',
        '@/(.*)$': '<rootDir>/src/$1',
    },
    setupFilesAfterEnv: ['./jest.setup.js'],
    testURL: 'https://localhost/',
    testEnvironment: 'jsdom',
    testRegex: '(/__tests__/.*|(\\.|/)(test|spec))\\.(jsx?|tsx?)$',
}
