// SPDX-License-Identifier: LGPL-3.0-or-later
//
// Fixes written back into a bot's files.
//
// --fix only makes edits that cannot change what the bot does: today, the letter case of function
// names. Each one is checked by parsing the code before and after (the parse ForgeScript's compiler
// gives, see test/parity.test.js): the edit is kept only if both give the same functions, fields
// and errors. Whitespace is never touched, because in ForgeScript it is part of what a bot sends.
//
// --fix-brackets changes what the bot sends, on purpose: it escapes a [ in an argument's text and the
// ] that closed the function too early, so the text is printed as it was written. Each edit is kept
// only if it removes the problem and adds no compile error.

import { CodeSource, extractCode } from "./extract"
import { AnyField, Call, parse, ParseResult, walk } from "./parser"
import { declaredSpelling, unescapedBrackets } from "./rules"
import { FunctionTable } from "./table"

export interface Fix {
    rule: "function-case" | "unescaped-bracket"
    /** File offset of the first character changed, in the text before the fix. */
    offset: number
    description: string
}

export interface FixOptions {
    /** Properties whose strings are code (default `["code"]`). */
    properties?: string[]
    /** Also escape brackets that close a function too early (changes what the bot sends). */
    brackets?: boolean
}

export interface FixResult {
    text: string
    fixes: Fix[]
    /** Edits that were found but not made, and why. */
    skipped: Fix[]
}

/** The fixes for one file's text. */
export function fixText(text: string, table: FunctionTable, options: FixOptions = {}): FixResult {
    const properties = options.properties?.length ? options.properties : ["code"]
    const fixes: Fix[] = []
    const skipped: Fix[] = []
    text = fixCase(text, table, properties, fixes, skipped)
    if (options.brackets) text = fixBrackets(text, table, properties, fixes, skipped)
    return { text, fixes, skipped }
}

const usable = (s: CodeSource) => !s.error && !s.dynamic

/** The file offsets of value[start..end), when they are the same characters in a row in the file. */
function plainSpan(text: string, src: CodeSource, start: number, end: number): number | null {
    const first = src.offsets[start]
    for (let i = start; i < end; i++) {
        const at = src.offsets[i]
        if (at !== first + (i - start) || text[at].toLowerCase() !== src.value[i].toLowerCase()) return null
    }
    return first
}

function fixCase(text: string, table: FunctionTable, properties: string[], fixes: Fix[], skipped: Fix[]): string {
    const edits: Array<{ at: number; to: string; fix: Fix; src: CodeSource }> = []
    for (const src of extractCode(text, properties).filter(usable)) {
        const res = parse(src.value, table, { recover: true })
        for (const call of walk(res.functions)) {
            const declared = declaredSpelling(call)
            if (!declared) continue
            const fix: Fix = { rule: "function-case", offset: -1, description: `$${call.written.slice(1)} → $${declared}` }
            const at = plainSpan(text, src, call.nameStart, call.nameEnd)
            if (at === null) {
                skipped.push({ ...fix, offset: src.offsets[call.nameStart] ?? src.start, description: `${fix.description}: the name is written with escapes in the file` })
                continue
            }
            edits.push({ at, to: declared, fix: { ...fix, offset: at }, src })
        }
    }
    if (!edits.length) return text
    // Same length, so offsets do not move. Check each code string as a whole after its edits.
    let out = text
    for (const e of edits) out = out.slice(0, e.at) + e.to + out.slice(e.at + e.to.length)
    const after = new Map(extractCode(out, properties).map((s) => [s.start, s]))
    const bad = new Set<CodeSource>()
    for (const src of new Set(edits.map((e) => e.src))) {
        const next = after.get(src.start)
        if (!next || !sameMeaning(parse(src.value, table, { recover: true }), parse(next.value, table, { recover: true }))) bad.add(src)
    }
    let result = text
    for (const e of edits) {
        if (bad.has(e.src)) skipped.push({ ...e.fix, description: `${e.fix.description}: the code would parse differently` })
        else {
            result = result.slice(0, e.at) + e.to + result.slice(e.at + e.to.length)
            fixes.push(e.fix)
        }
    }
    return result
}

/** Two parses mean the same: same functions (by registered name), flags, fields, operators, template and errors. */
export function sameMeaning(a: ParseResult, b: ParseResult): boolean {
    const field = (f: AnyField): unknown => (f.kind === "condition" ? [f.op, field(f.lhs), f.rhs && field(f.rhs)] : [f.value, f.functions.map(call)])
    const call = (c: Call): unknown => [c.name, c.index, c.negated, c.silent, c.count, c.fields?.map(field) ?? null]
    const errors = (r: ParseResult) => r.errors.map((e) => [e.kind, e.message, e.line, e.column])
    return JSON.stringify([a.code, a.functions.map(call), errors(a)]) === JSON.stringify([b.code, b.functions.map(call), errors(b)])
}

function fixBrackets(text: string, table: FunctionTable, properties: string[], fixes: Fix[], skipped: Fix[]): string {
    const tried = new Set<string>()
    for (let round = 0; round < 500; round++) {
        let applied = false
        for (const src of extractCode(text, properties).filter(usable)) {
            const res = parse(src.value, table, { recover: true })
            for (const item of unescapedBrackets(src.value, res)) {
                const key = `${src.start}:${src.offsets[item.close]}`
                if (tried.has(key)) continue
                tried.add(key)
                const positions = [...item.opens, item.close].map((i) => plainSpan(text, src, i, i + 1))
                const fix: Fix = { rule: "unescaped-bracket", offset: src.offsets[item.close], description: `escaped the [ ] in ${item.call.name}'s text` }
                if (positions.some((p) => p === null)) {
                    skipped.push({ ...fix, description: `${fix.description}: a bracket is written with escapes in the file` })
                    continue
                }
                // \\ in a JavaScript string is one backslash, which ForgeScript reads as an escape.
                let next = text
                for (const p of (positions as number[]).sort((a, b) => b - a)) next = next.slice(0, p) + "\\\\" + next.slice(p)
                const after = extractCode(next, properties).find((s) => s.start === src.start)
                const now = after && parse(after.value, table, { recover: true })
                const better = now && now.errors.length <= res.errors.length && unescapedBrackets(after!.value, now).length < unescapedBrackets(src.value, res).length
                if (!better) {
                    skipped.push({ ...fix, description: `${fix.description}: escaping them would leave ${item.call.name} unclosed or another bracket wrong` })
                    continue
                }
                fixes.push(fix)
                text = next
                applied = true
                break
            }
            if (applied) break
        }
        if (!applied) break
    }
    return text
}
