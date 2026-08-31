/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
*/
/**
 * Build-time values injected by Vite.
 *
 * This module exists to hold exactly one line. `import.meta` is a *syntax*
 * error once TypeScript compiles to CommonJS, which is what Jest does — so a
 * single `import.meta.env` read anywhere in a module makes that module, and
 * everything that imports it, unloadable in tests. AVXTOConf.ts is imported by
 * the asset store, so that one line took the entire Avalanche store graph out
 * of reach of the test suite.
 *
 * No runtime guard can help, because the failure is at parse time. Isolating
 * the read here means the test double (tests/stubs/buildEnv.ts, wired up in
 * jest.config.js) replaces this one value and nothing else — no real constant
 * is ever shadowed by a copy that could drift.
 *
 * Import it through the `@/avxto/buildEnv` alias, never relatively: Jest's
 * moduleNameMapper matches the import string rather than the resolved file, so
 * a relative path would slip past the substitution and reintroduce the very
 * syntax error this file exists to contain.
 *
 * Anything else needing `import.meta` belongs here too, for the same reason.
 */
export const APP_VERSION = (import.meta.env.VITE_APP_VERSION as string) ?? 'dev'
