/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
// Export all vue_components for use in the application.
//
// Each component file used to also do `export { X }` alongside its
// `export default X` (and this barrel re-exported both), which broke
// component resolution in the production build specifically: consumers
// importing the named export got an undefined component, so Vue silently
// rendered an empty comment node in its place (the "Invalid vnode type"
// warning for that is dev-only, hence no console output). A single default
// export per file, re-exported here under its real name, is what every
// other component in this codebase already does.
export { default as BigNumInput } from './bignum_input.vue'
export { default as QrReader } from './qr_reader.vue'
export { default as QrInput } from './qr_input.vue'
export { default as CopyText } from './CopyText.vue'
