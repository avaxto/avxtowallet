/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
*/
/**
 * jsdom, with Node's binary and Fetch globals rather than jsdom's own.
 *
 * jsdom runs the test inside its own V8 realm, which has its own
 * `Uint8Array`, `ArrayBuffer` and friends. Node's `Buffer`, injected into that
 * realm from the outside, still extends *Node's* `Uint8Array` — so
 * `someBuffer instanceof Uint8Array` is **false** inside a test, even though a
 * Buffer is a Uint8Array by every other measure.
 *
 * Nothing in this codebase would notice, but the cryptography libraries do.
 * `tiny-secp256k1` validates every argument with `instanceof Uint8Array`, and
 * `ecpair` self-tests it on construction using `Buffer.from(hex)`. Every check
 * fails, and the whole thing surfaces as `ecc library invalid` thrown from
 * `ECPairFactory` — an error that says nothing about realms and sends you
 * looking at the elliptic curve library, which is fine.
 *
 * This module is evaluated in the Node realm, so the constructors it reads are
 * Node's. Assigning them onto `this.global` — jsdom's realm — makes the two
 * agree. This is the standard fix for running bitcoinjs under jest-jsdom.
 *
 * The missing web APIs below are here rather than in a `setupFiles` script for
 * the same reason: several are read at module scope by dependencies, so
 * installing them once the test framework is already up is too late — the
 * import throws first.
 */
const { TestEnvironment: JSDOMEnvironment } = require('jest-environment-jsdom')

/** Constructors whose identity must match across the realm boundary. */
const BINARY_GLOBALS = [
    'ArrayBuffer',
    'SharedArrayBuffer',
    'Uint8Array',
    'Uint8ClampedArray',
    'Uint16Array',
    'Uint32Array',
    'Int8Array',
    'Int16Array',
    'Int32Array',
    'Float32Array',
    'Float64Array',
    'BigInt64Array',
    'BigUint64Array',
    'DataView',
    'Buffer',
]

/**
 * Web APIs jsdom does not implement but Node has.
 *
 * The Fetch four are here because `@avalanche-sdk/chainkit` subclasses
 * `Request` at module scope: without them, importing anything that reaches the
 * Avalanche SDK died with `ReferenceError: Request is not defined` before a
 * single test could run. TextEncoder/TextDecoder are used throughout the
 * cryptography and keystore code.
 */
const WEB_GLOBALS = [
    'fetch',
    'Request',
    'Response',
    'Headers',
    'FormData',
    'Blob',
    'File',
    'TextEncoder',
    'TextDecoder',
    'structuredClone',
]

class AvxtoTestEnvironment extends JSDOMEnvironment {
    constructor(config, context) {
        super(config, context)

        for (const name of [...BINARY_GLOBALS, ...WEB_GLOBALS]) {
            if (globalThis[name] !== undefined) {
                this.global[name] = globalThis[name]
            }
        }

    }

    /**
     * Web Crypto, installed after jsdom has finished building the window.
     *
     * The session vault is built on `crypto.subtle`, and jsdom provides a
     * `crypto` object with no `subtle` on it. Assigning in the constructor does
     * not survive — jsdom defines its own afterwards — so this has to happen in
     * the `setup` lifecycle, which still runs before the first module is
     * evaluated.
     */
    async setup() {
        await super.setup()
        Object.defineProperty(this.global, 'crypto', {
            value: require('crypto').webcrypto,
            configurable: true,
            writable: true,
        })
    }
}

module.exports = AvxtoTestEnvironment
