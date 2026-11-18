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
//
// --reindent is opt-in, because the whitespace it changes can reach what the bot sends: inside an
// argument it is part of the value, and ForgeScript only trims the two ends of a message. It sets
// the indentation of lines that start with a function, a ; or a ], by nesting depth, and nothing
// else; the result must parse the same apart from that whitespace. It leaves a line alone when the
// argument it is in also has text (the whitespace would sit among words that are sent), and inside a
// condition (where it is part of what is compared).

import { CodeSource, extractCode } from "./extract"
import { AnyField, Call, Field, parse, ParseResult, walk } from "./parser"
import { declaredSpelling, unescapedBrackets } from "./rules"
import { FunctionTable } from "./table"

export interface Fix {
    rule: "function-case" | "unescaped-bracket" | "reindent"
    /** File offset of the first character changed, in the text before the fix. */
    offset: number
    description: string
}

export interface FixOptions {
    /** Properties whose strings are code (default `["code"]`). */
    properties?: string[]
    /** Fix the letter case of names (default true). */
    case?: boolean
    /** Escape brackets that close a function too early (changes what the bot sends). */
    brackets?: boolean
    /** Re-indent lines that start with a function, ; or ] (can change what the bot sends). */
    reindent?: boolean
    /** Spaces per level, or "tab". Default: detected from the code, else 4. */
    indent?: number | "tab"
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
    if (options.case !== false) text = fixCase(text, table, properties, fixes, skipped)
    if (options.brackets) text = fixBrackets(text, table, properties, fixes, skipped)
    if (options.reindent) text = reindent(text, table, properties, options.indent, fixes, skipped)
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

/** The nesting depth at a position: how many calls with brackets enclose it. */
function depthAt(calls: Call[], at: number): number {
    return calls.filter((c) => c.open !== null && c.open < at && at <= (c.close ?? Infinity)).length
}

/** The same parse, apart from whitespace at the start of lines. */
function sameIgnoringIndent(a: ParseResult, b: ParseResult): boolean {
    const norm = (v: string) => v.replace(/\n[ \t]*/g, "\n")
    const field = (f: AnyField): unknown => (f.kind === "condition" ? [f.op, field(f.lhs), f.rhs && field(f.rhs)] : [norm(f.value), f.functions.map(call)])
    const call = (c: Call): unknown => [c.name, c.index, c.negated, c.silent, c.count, c.fields?.map(field) ?? null]
    return !a.errors.length && !b.errors.length && JSON.stringify([norm(a.code), a.functions.map(call)]) === JSON.stringify([norm(b.code), b.functions.map(call)])
}

function reindent(text: string, table: FunctionTable, properties: string[], indent: number | "tab" | undefined, fixes: Fix[], skipped: Fix[]): string {
    // From the end of the file, so earlier offsets stay valid.
    const sources = extractCode(text, properties).filter((s) => usable(s) && text[s.start] === "`" && s.value.includes("\n"))
    for (const src of sources.reverse()) {
        const res = parse(src.value, table, { recover: true })
        if (res.errors.length) {
            skipped.push({ rule: "reindent", offset: src.start, description: "not re-indented: the code does not compile" })
            continue
        }
        const calls = Array.from(walk(res.functions))
        const starts = new Map(calls.map((c) => [c.start, c]))
        // Where each line's whitespace ends up: the innermost argument around it, or the top level.
        type Container = { start: number; end: number; condition: boolean; field: Field | null }
        const containers: Container[] = [{ start: 0, end: src.value.length, condition: false, field: null }]
        for (const c of calls) {
            for (const f of c.fields ?? []) {
                if (f.kind === "condition") containers.push({ start: f.start, end: f.end, condition: true, field: null })
                else containers.push({ start: f.start, end: f.end, condition: false, field: f })
            }
        }
        const containerOf = (at: number) => containers.filter((x) => x.start <= at && at <= x.end).sort((a, b) => a.end - a.start - (b.end - b.start))[0]
        const hasText = (x: Container) => {
            const fns = x.field ? x.field.functions : res.functions
            let k = 0
            for (let i = x.start; i < (x.field ? x.end : src.value.length); i++) {
                const inner = fns[k]
                if (inner && i === inner.start) {
                    i = inner.end - 1
                    k++
                    continue
                }
                if (!/\s/.test(src.value[i])) return true
            }
            return false
        }
        const owner = new Map<number, Call>()
        for (const c of calls) {
            for (const sep of c.separators) owner.set(sep, c)
            if (c.close !== null) owner.set(c.close, c)
        }
        // Each line after the first: its indentation, and the depth it should have, when it starts with a call, ; or ].
        const lines: Array<{ start: number; first: number; depth: number }> = []
        // The bot's own indentation for top-level functions, from every such line (moved or not).
        let base: string | null = null
        for (let i = src.value.indexOf("\n"); i >= 0; i = src.value.indexOf("\n", i + 1)) {
            const start = i + 1
            let first = start
            while (src.value[first] === " " || src.value[first] === "\t") first++
            if (first >= src.value.length || src.value[first] === "\n") continue
            const call = starts.get(first)
            const own = owner.get(first)
            if (!call && !own) continue
            const depth = call ? depthAt(calls, first) : depthAt(calls, own!.start)
            if (call && depth === 0 && base === null) base = src.value.slice(start, first)
            const where = containerOf(first)
            if (where.condition || hasText(where)) {
                const why = where.condition ? "it is inside a condition, where whitespace is compared" : "its argument also has text, so this whitespace is sent with it"
                skipped.push({ rule: "reindent", offset: src.offsets[start] ?? src.start, description: `not re-indented: ${why}` })
                continue
            }
            lines.push({ start, first, depth })
        }
        if (!lines.length) continue
        const current = (l: { start: number; first: number }) => src.value.slice(l.start, l.first)
        base ??= ""
        let unit = indent === "tab" ? "\t" : typeof indent === "number" ? " ".repeat(indent) : ""
        if (!unit) {
            const nested = lines.filter((l) => l.depth > 0).map((l) => current(l))
            if (nested.some((w) => w.startsWith(base! + "\t"))) unit = "\t"
            else {
                const steps = lines.filter((l) => l.depth > 0).map((l) => (current(l).length - base!.length) / l.depth).filter((n) => Number.isInteger(n) && n > 0)
                unit = " ".repeat(steps.length ? Math.min(...steps) : 4)
            }
        }
        let next = text
        const changed: Fix[] = []
        for (const l of [...lines].reverse()) {
            const want = base! + unit.repeat(l.depth)
            if (current(l) === want) continue
            const from = l.first > l.start ? plainSpan(text, src, l.start, l.first) : src.offsets[l.first]
            if (from === null || from === undefined || text[src.offsets[l.first]] !== src.value[l.first]) continue
            const to = src.offsets[l.first]
            next = next.slice(0, from) + want + next.slice(to)
            changed.push({ rule: "reindent", offset: from, description: `indent ${JSON.stringify(current(l))} → ${JSON.stringify(want)}` })
        }
        if (!changed.length) continue
        const after = extractCode(next, properties).find((s) => s.start === src.start)
        if (!after || !sameIgnoringIndent(res, parse(after.value, table, { recover: true }))) {
            skipped.push({ rule: "reindent", offset: src.start, description: "not re-indented: the code would parse differently" })
            continue
        }
        text = next
        fixes.push(...changed.reverse())
    }
    return text
}
