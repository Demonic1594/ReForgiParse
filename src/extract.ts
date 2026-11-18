// SPDX-License-Identifier: LGPL-3.0-or-later
//
// Finds ForgeScript code in JavaScript and TypeScript files.
//
// ForgeScript never sees what is typed in a .js file: it sees the string after JavaScript has
// processed its escapes (`\\;` in a template literal reaches ForgeScript as `\;`). This does that
// step and keeps, for every character of the result, where it came from in the file, so problems
// are reported at the right line and column.

/** A string value of a `code:` (or other configured) property. */
export interface CodeSource {
    /** The property, e.g. `code`. */
    property: string
    /** The string as ForgeScript receives it. `${...}` parts are replaced by {@link DYNAMIC}. */
    value: string
    /** `offsets[i]`: where `value[i]` comes from in the file. */
    offsets: number[]
    /** The opening quote. */
    start: number
    /** Right after the closing quote. */
    end: number
    /** A template literal with `${...}`: those parts are only known when the bot runs. */
    dynamic: boolean
    /** Why the literal could not be read to its end, if it could not. */
    error: string | null
}

/** Stands for each `${...}` in a template literal. */
export const DYNAMIC = "\u0000"

const LINE_TERMINATORS = "\n\r  "
const SIMPLE: Record<string, string> = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", v: "\v" }

interface Cooked {
    value: string
    offsets: number[]
    end: number
    dynamic: boolean
    error: string | null
}

/** Reads the string or template literal whose opening quote is at `text[i]`, as JavaScript would. */
export function cook(text: string, i: number): Cooked {
    const quote = text[i]
    let value = ""
    const offsets: number[] = []
    let dynamic = false
    let j = i + 1
    const n = text.length
    const push = (s: string, at: number) => {
        value += s
        for (let k = 0; k < s.length; k++) offsets.push(at)
    }
    const done = (end: number, error: string | null): Cooked => ({ value, offsets, end, dynamic, error })
    while (j < n) {
        const c = text[j]
        if (c === quote) return done(j + 1, null)
        if (quote !== "`" && (c === "\n" || c === "\r")) return done(j, "unterminated string")
        if (quote === "`" && c === "$" && text[j + 1] === "{") {
            dynamic = true
            let depth = 1
            let k = j + 2
            while (k < n && depth) {
                const ch = text[k]
                if (ch === '"' || ch === "'" || ch === "`") {
                    k = cook(text, k).end
                    continue
                }
                if (ch === "/" && (text[k + 1] === "/" || text[k + 1] === "*")) {
                    k = skipComment(text, k)
                    continue
                }
                if (ch === "/" && regexCanStart(text, k, j + 2)) {
                    k = skipRegex(text, k)
                    continue
                }
                if (ch === "{") depth++
                else if (ch === "}") depth--
                k++
            }
            push(DYNAMIC, j)
            j = k
            continue
        }
        if (c === "\r" && quote === "`") {
            // Template literals turn CRLF and CR into LF.
            push("\n", j)
            j += text[j + 1] === "\n" ? 2 : 1
            continue
        }
        if (c !== "\\") {
            push(c, j)
            j++
            continue
        }
        if (j + 1 >= n) return done(n, "unterminated escape")
        const e = text[j + 1]
        if (LINE_TERMINATORS.includes(e)) {
            // A line continuation adds nothing.
            j += e === "\r" && text[j + 2] === "\n" ? 3 : 2
            continue
        }
        if (e in SIMPLE) {
            push(SIMPLE[e], j)
            j += 2
            continue
        }
        if (e === "0" && !/[0-9]/.test(text[j + 2] ?? "")) {
            push("\0", j)
            j += 2
            continue
        }
        if (e === "x") {
            const hex = /^[0-9a-fA-F]{2}/.exec(text.slice(j + 2, j + 4))
            if (hex) {
                push(String.fromCharCode(parseInt(hex[0], 16)), j)
                j += 4
                continue
            }
            return done(j, "invalid \\x escape")
        }
        if (e === "u") {
            const m = /^(?:\{([0-9a-fA-F]{1,6})\}|([0-9a-fA-F]{4}))/.exec(text.slice(j + 2, j + 12))
            const cp = m ? parseInt(m[1] ?? m[2], 16) : NaN
            if (m && cp <= 0x10ffff) {
                push(String.fromCodePoint(cp), j)
                j += 2 + m[0].length
                continue
            }
            return done(j, "invalid \\u escape")
        }
        // Any other escaped character stands for itself (\\ \` \$ \' \" \[ \; ...).
        push(e, j)
        j += 2
    }
    return done(n, "unterminated literal")
}

/** Words after which a `/` starts a regular expression, not a division. */
const BEFORE_REGEX = new Set(["return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await"])

/**
 * Whether a `/` at `text[i]` (not a comment) starts a regular expression literal, judged as
 * JavaScript's grammar does in practice: after a value (a name, number, string, `)` or `]`) it is a
 * division; after an operator, punctuation, a keyword such as `return`, or nothing, a regex.
 */
export function regexCanStart(text: string, i: number, from = 0): boolean {
    let k = i - 1
    while (k >= from && /\s/.test(text[k])) k--
    if (k < from) return true
    const p = text[k]
    if (/[\w$]/.test(p)) {
        let w = k
        while (w > from && /[\w$]/.test(text[w - 1])) w--
        return BEFORE_REGEX.has(text.slice(w, k + 1))
    }
    return !/[)\]"'`.]/.test(p)
}

/** The end of the regular expression literal starting at `text[i]`, past its flags. */
export function skipRegex(text: string, i: number): number {
    let inClass = false
    for (let k = i + 1; k < text.length; k++) {
        const c = text[k]
        if (c === "\n" || c === "\r") return i + 1 // not a regex after all: a line cannot hold half of one
        if (c === "\\") k++
        else if (c === "[") inClass = true
        else if (c === "]") inClass = false
        else if (c === "/" && !inClass) {
            k++
            while (k < text.length && /[a-z]/i.test(text[k])) k++
            return k
        }
    }
    return i + 1
}

/** The end of the line or block comment starting at `text[i]`; the end of the text when a block comment is never closed. */
export function skipComment(text: string, i: number): number {
    if (text[i + 1] === "/") {
        const j = text.indexOf("\n", i)
        return j < 0 ? text.length : j
    }
    const j = text.indexOf("*/", i + 2)
    return j < 0 ? text.length : j + 2
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/**
 * Every string value of the given properties (default `code`) in a JavaScript or TypeScript file,
 * as ForgeScript receives it, with where each character comes from. Comments and other strings are
 * skipped, so `code:` inside them does not count.
 */
export function extractCode(text: string, properties: readonly string[] = ["code"]): CodeSource[] {
    const names = [...new Set(properties)].sort((a, b) => b.length - a.length).map(escapeRegex).join("|")
    const prop = new RegExp(`(["']?)(${names})\\1\\s*:\\s*(["'\`])`, "y")
    const found: CodeSource[] = []
    let i = 0
    const n = text.length
    while (i < n) {
        const c = text[i]
        if (c === "/" && (text[i + 1] === "/" || text[i + 1] === "*")) {
            i = skipComment(text, i)
            continue
        }
        if (!/[\w$.]/.test(text[i - 1] ?? "")) {
            prop.lastIndex = i
            const m = prop.exec(text)
            if (m) {
                const q = prop.lastIndex - 1
                const r = cook(text, q)
                found.push({ property: m[2], value: r.value, offsets: r.offsets, start: q, end: r.end, dynamic: r.dynamic, error: r.error })
                i = r.end
                continue
            }
        }
        if (c === '"' || c === "'" || c === "`") {
            i = cook(text, i).end
            continue
        }
        if (c === "/" && regexCanStart(text, i)) {
            i = skipRegex(text, i)
            continue
        }
        i++
    }
    return found
}

/** The file offset of `source.value[index]` (or right after the last character). */
export function fileOffset(source: CodeSource, index: number): number {
    if (!source.offsets.length) return source.start + 1
    if (index >= source.offsets.length) return source.offsets[source.offsets.length - 1] + 1
    return source.offsets[Math.max(0, index)]
}

/**
 * Line and column lookups for one text, after one pass over it: for many offsets in the same file
 * (each finding's start and end), where {@link lineColumn} would scan from the start every time.
 */
export function lineIndex(text: string): (offset: number) => { line: number; column: number } {
    const starts = [0]
    for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1)
    return (offset) => {
        const at = Math.min(Math.max(offset, 0), text.length)
        let lo = 0
        let hi = starts.length - 1
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1
            if (starts[mid] <= at) lo = mid
            else hi = mid - 1
        }
        return { line: lo + 1, column: offset - starts[lo] + 1 }
    }
}

/** 1-based line and column of a file offset. */
export function lineColumn(text: string, offset: number) {
    let line = 1
    let last = -1
    for (let i = 0; i < offset && i < text.length; i++) {
        if (text[i] === "\n") line++, (last = i)
    }
    return { line, column: offset - last }
}
