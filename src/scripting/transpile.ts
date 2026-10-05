/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * TypeScript → JavaScript for scripts, by erasing the types (sucrase). There
 * is no type checking and no runtime effect: types are an authoring aid, never
 * a safety boundary — the sandbox and the plan review are. Plain JavaScript
 * passes through unchanged.
 *
 * Loaded on first use, alongside the engine.
 */

/** Strips TypeScript syntax. Throws with the line number on a syntax error. */
export async function toJavaScript(source: string): Promise<string> {
    const { transform } = await import('sucrase')
    try {
        return transform(source, { transforms: ['typescript'], disableESTransforms: true }).code
    } catch (e: any) {
        const msg = String(e?.message ?? e)
        throw new Error(`Syntax error: ${msg}`)
    }
}

/**
 * Module syntax has no meaning in the sandbox — there is nothing to import
 * from, and fetching code from a URL is exactly what scripts must never do.
 * Named up front so the user gets a clear message instead of a parse error.
 */
export function moduleSyntaxError(source: string): string {
    const m = /^\s*(import|export)\b[^\n]*/m.exec(source)
    if (!m) return ''
    return `Scripts cannot use "${m[1]}": they run alone, with only the wallet API (no modules, no URLs). Line: ${m[0].trim()}`
}
