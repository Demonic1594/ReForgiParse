// SPDX-License-Identifier: LGPL-3.0-or-later
import { parse, ParseResult, walk } from "./parser"
import { FunctionTable } from "./table"

/** A `$word` that ForgeScript does not run as written. */
export interface NameIssue {
    /**
     * `unknown`: no function has this name, so it is printed as text.
     * `glued`: a shorter function name matches its start, so that function runs and the rest is
     * printed after it (`$pingms` runs `$ping`, then prints `ms`).
     */
    kind: "unknown" | "glued"
    start: number
    end: number
    /** As written, e.g. `$pingms`. */
    written: string
    /** For `glued`: the function that runs. */
    runs: string | null
    /** For `glued`: the text printed after it. */
    rest: string
}

// A name starts with a letter or `_`: `$5` is a price, not a misspelt function.
const TOKEN = /\$(?:!)?(?:#)?(?:@\[.*?\])?([A-Za-z_][A-Za-z0-9_]*)/g

/**
 * The `$words` ForgeScript does not treat as written. It uses the compiler's own matching, so it
 * agrees with what runs; escaped `\$words` are skipped.
 */
export function nameIssues(code: string, table: FunctionTable, result?: ParseResult): NameIssue[] {
    const res = result ?? parse(code, table, { recover: true })
    const calls = new Map(Array.from(walk(res.functions), (c) => [c.start, c]))
    const out: NameIssue[] = []
    for (const m of code.matchAll(TOKEN)) {
        const start = m.index!
        let slashes = 0
        for (let k = start - 1; k >= 0 && code[k] === "\\"; k--) slashes++
        if (slashes % 2) continue
        const end = start + m[0].length
        const call = calls.get(start)
        if (!call) out.push({ kind: "unknown", start, end, written: `$${m[1]}`, runs: null, rest: "" })
        else if (call.nameEnd < end) out.push({ kind: "glued", start, end, written: `$${m[1]}`, runs: call.name, rest: code.slice(call.nameEnd, end) })
    }
    return out
}
