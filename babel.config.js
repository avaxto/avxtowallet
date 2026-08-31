/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
*/
/**
 * Babel is used ONLY by Jest, to transform plain `.js` — the few JS files in
 * `src/` and any dependency shipping ES modules. Vite compiles the application
 * itself with esbuild and never reads this file.
 *
 * It previously extended `@vue/cli-plugin-babel/preset` together with four
 * `@babel/proposal-*` plugins. None of those packages have ever been installed
 * here: this is a Vite project, and that preset belongs to Vue CLI. Requiring
 * them is one of the two reasons `yarn test` could not start.
 */
module.exports = {
    presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
}
