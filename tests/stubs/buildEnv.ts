/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
*/
/**
 * Test double for src/avxto/buildEnv.ts, wired up in jest.config.js.
 *
 * That module exists only to isolate the one `import.meta` read in the app.
 * `import.meta` is a *syntax* error once TypeScript compiles to CommonJS, so no
 * runtime guard can help — the file has to be swapped out wholesale, and it is
 * kept to a single value precisely so that swapping it diverges nothing else.
 */
export const APP_VERSION = 'test'
