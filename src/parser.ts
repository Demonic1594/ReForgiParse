// SPDX-License-Identifier: LGPL-3.0-or-later
//
// ForgeParse: ForgeScript's compiler as a parser.
//
// The algorithm reproduces ForgeScript's own compiler (github.com/tryforge/ForgeScript,
// src/core/Compiler.ts, LGPL-3.0-or-later, Copyright (c) BotForge), so that for any input the
// tree, fields, condition operators, output template and compile errors (message, line and
// column) are the ones ForgeScript produces. test/parity.test.js checks this against the real
// compiler. On top of that it records where everything is in the source, and can keep going after
// an error and report every one (`recover: true`).

import { FunctionTable, IRawField, IRawFunction } from "./table"

export const Syntax = { Open: "[", Close: "]", Escape: "\\", Separator: ";" } as const

/** Condition operators, two-character ones first (`OperatorType` in ForgeScript). */
export const Operators = ["==", "!=", "<=", ">=", ">", "<"] as const
export type Operator = (typeof Operators)[number] | "unknown"

/** A placeholder in a template, with any backslashes right before it (`Compiler.SystemRegex`). */
export const PlaceholderRegex = /(\\+)?\[SYSTEM_FUNCTION\(\d+\)\]/gm

/** An argument. Offsets are UTF-16 indexes into the source, like JavaScript string indexes. */
export interface Field {
    kind: "field"
    /** The text with each call replaced by its placeholder and escapes resolved (`value`). */
    value: string
    /** The text with escapes resolved and calls as written (`rawValue`). */
    raw: string
    /** The calls right inside it, in order. */
    functions: Call[]
    /** The first character. */
    start: number
    /** The `;` or `]` that ends it, or the source's length when it is not closed. */
    end: number
}

/** A condition argument (`$if[$get[a]>=1;...]`), split at its first operator. */
export interface ConditionField {
    kind: "condition"
    /** `"unknown"` when the field has no operator: then all of it is `lhs`. */
    op: Operator
    lhs: Field
    rhs: Field | null
    /** Where the operator is, `null` without one. */
    opStart: number | null
    start: number
    end: number
}

export type AnyField = Field | ConditionField

/** A function call. */
export interface Call {
    /** The name of the function that runs, as registered (`$authorID` for `$AUTHORID`). */
    name: string
    /** The name as written, without `!`, `#` or `@[...]`. */
    written: string
    fn: IRawFunction
    /** ForgeScript's number for it: inner calls come first. Its placeholder is `[SYSTEM_FUNCTION(index)]`. */
    index: number
    negated: boolean
    silent: boolean
    /** The text in `@[...]`, `null` without it. */
    count: string | null
    /** `null` without brackets (or for a function that takes none). */
    fields: AnyField[] | null
    /** The `$`. */
    start: number
    nameStart: number
    nameEnd: number
    /** The `[`, `null` without brackets. */
    open: number | null
    /** The `]`, `null` without brackets or when it is not closed. */
    close: number | null
    /** The `;` between arguments. */
    separators: number[]
    /** Right after the call. */
    end: number
}

export type CompileErrorKind = "requires-brackets" | "too-many-args" | "missing-closure"

/** A compile error, with ForgeScript's message and position. */
export class CompileError extends Error {
    constructor(
        message: string,
        /** 1-based, as ForgeScript reports it. */
        readonly line: number,
        /** 0-based, in UTF-16 units, as ForgeScript reports it. */
        readonly column: number,
        readonly offset: number,
        readonly kind: CompileErrorKind,
    ) {
        super(message)
        this.name = "CompileError"
    }
}

export interface ParseResult {
    /** The source. */
    source: string
    /** The top level as a template, with a placeholder per call (`Compiler.compile().code`). */
    code: string
    /** The top-level calls. */
    functions: Call[]
    /** Every compile error. In strict mode there are none: the first one is thrown. */
    errors: CompileError[]
}

export interface ParseOptions {
    /** Keep going after an error and record every one in `errors` (default: throw the first, like ForgeScript). */
    recover?: boolean
}

interface Match {
    index: number
    length: number
    negated: boolean
    silent: boolean
    count: string | null
    fn: IRawFunction
    written: string
    nameStart: number
}

const RECOVER_FIELD: IRawField = { condition: false, rest: true }

class Compiler {
    private readonly matches: Match[]
    private readonly errors: CompileError[] = []
    private id = 0
    private index = 0
    private matchIndex = 0

    constructor(
        private readonly code: string,
        table: FunctionTable,
        private readonly recover: boolean,
    ) {
        this.matches = Array.from(code.matchAll(table.regex), (m) => {
            const nameStart = m.index! + 1 + (m[1] ? 1 : 0) + (m[2] ? 1 : 0) + (m[3] ? m[3].length : 0)
            return {
                index: m.index!,
                length: m[0].length,
                negated: !!m[1],
                silent: !!m[2],
                count: m[4] ?? null,
                // The regular expression is built from the table, so every match has a function.
                fn: table.get(m[5])!,
                written: `$${m[5]}`,
                nameStart,
            }
        })
    }

    private get match(): Match | undefined {
        return this.matches[this.matchIndex]
    }

    private char() {
        return this.code[this.index]
    }

    /**
     * The current offset for a position in the tree. ForgeScript's own index can run past the end
     * (a lone `\` at the end of an unclosed field steps over it); positions never do.
     */
    private at() {
        return Math.min(this.index, this.code.length)
    }

    private back() {
        return this.code[this.index - 1]
    }

    /** Line (1-based) and column (0-based), counted as ForgeScript counts them. */
    private locate(index: number) {
        let line = 1
        let column = 0
        for (let i = 0; i < index; i++) {
            if (this.code[i] === "\n") line++, (column = 0)
            else column++
        }
        return { line, column }
    }

    private error(message: string, kind: CompileErrorKind) {
        const { line, column } = this.locate(this.index)
        const err = new CompileError(message, line, column, this.index, kind)
        if (!this.recover) throw err
        this.errors.push(err)
    }

    /** `\x`: the character after the backslash, never a call. Past the end it is `"undefined"`, as in ForgeScript. */
    private escape(): string {
        this.index++
        const next = this.char()
        if (this.match?.index === this.index) this.matchIndex++
        this.index++
        return String(next)
    }

    compile(): ParseResult {
        let out = ""
        const functions: Call[] = []
        if (this.matches.length) {
            loop: for (let m = this.match; m !== undefined; m = this.match) {
                // Cannot happen in ForgeScript's grammar (matches never overlap what was consumed),
                // but ForgeScript would loop for ever here; skip the match instead.
                if (m.index < this.index) {
                    this.matchIndex++
                    continue
                }
                while (m.index !== this.index) {
                    if (this.char() === Syntax.Escape) {
                        out += this.escape()
                        continue loop
                    }
                    out += this.char()
                    this.index++
                }
                const call = this.parseFunction()
                functions.push(call)
                out += placeholder(call.index)
            }
            out += this.code.slice(this.index)
        } else out = this.code
        return { source: this.code, code: out, functions, errors: this.errors }
    }

    private parseFunction(): Call {
        const m = this.matches[this.matchIndex++]
        this.index += m.length
        const fn = m.fn
        const nameEnd = this.index
        const hasFields = this.char() === Syntax.Open
        if (!hasFields && fn.args?.required) {
            this.error(`Function ${fn.name} requires brackets`, "requires-brackets")
            return this.prepare(m, null, nameEnd)
        }
        if (!hasFields || fn.args === null) return this.prepare(m, null, nameEnd)

        const open = this.index++
        const fields: AnyField[] = []
        const separators: number[] = []
        const specs = fn.args.fields
        for (let i = 0; i < specs.length; i++) {
            const spec = specs[i]
            if (!spec.rest) fields.push(this.parseAnyField(m, spec))
            else {
                for (;;) {
                    fields.push(this.parseAnyField(m, spec))
                    if (this.back() !== Syntax.Separator) break
                    separators.push(this.index - 1)
                }
            }
            if (this.back() !== Syntax.Separator) break
            if (!spec.rest) separators.push(this.index - 1)
            if (i + 1 === specs.length) {
                this.error(`Function ${fn.name} expects ${specs.length} arguments at most`, "too-many-args")
                // Recovering: read the extra arguments so the rest of the code stays in step.
                for (;;) {
                    fields.push(this.parseAnyField(m, RECOVER_FIELD))
                    if (this.back() !== Syntax.Separator) break
                    separators.push(this.index - 1)
                }
                break
            }
        }
        const call = this.prepare(m, fields, nameEnd)
        call.open = open
        call.close = this.back() === Syntax.Close && fields.length ? this.index - 1 : null
        call.separators = separators
        return call
    }

    private prepare(m: Match, fields: AnyField[] | null, nameEnd: number): Call {
        return {
            name: m.fn.name,
            written: m.written,
            fn: m.fn,
            index: this.id++,
            negated: m.negated,
            silent: m.silent,
            count: m.count,
            fields,
            start: m.index,
            nameStart: m.nameStart,
            nameEnd,
            open: null,
            close: null,
            separators: [],
            end: this.at(),
        }
    }

    private parseAnyField(ref: Match, spec: IRawField): AnyField {
        const field = spec.condition ? this.parseConditionField(ref) : this.parseNormalField(ref)
        // Past the `;` or `]` (or one past the end when the field is not closed, as ForgeScript does).
        this.index++
        return field
    }

    /**
     * The loop both field kinds share. `onChar` may take a character (the condition operator).
     * Returns whether the field was closed by `;` or `]`.
     */
    private readField(acc: { value: string; raw: string; functions: Call[] }, onChar?: () => boolean): boolean {
        for (let ch = this.char(); ch !== undefined; ch = this.char()) {
            if (ch === Syntax.Escape) {
                const c = this.escape()
                acc.value += c
                acc.raw += c
                continue
            }
            if (ch === Syntax.Close || ch === Syntax.Separator) return true
            const m = this.match
            if (m?.index === this.index) {
                const start = this.index
                const call = this.parseFunction()
                acc.functions.push(call)
                acc.value += placeholder(call.index)
                acc.raw += this.code.slice(start, this.index)
                continue
            }
            if (onChar?.()) continue
            acc.value += ch
            acc.raw += ch
            this.index++
        }
        return false
    }

    private parseNormalField(ref: Match): Field {
        const start = this.index
        const acc = { value: "", raw: "", functions: [] as Call[] }
        if (!this.readField(acc)) this.error(`Function ${ref.fn.name} is missing brace closure`, "missing-closure")
        return { kind: "field", ...acc, start, end: this.at() }
    }

    private parseConditionField(ref: Match): ConditionField {
        const start = this.index
        let acc = { value: "", raw: "", functions: [] as Call[] }
        let op: Operator | null = null
        let opStart: number | null = null
        let lhs: Field | null = null
        const closed = this.readField(acc, () => {
            if (op !== null) return false
            const ch = this.char()
            const two = ch + (this.code[this.index + 1] ?? "undefined")
            const found = (Operators as readonly string[]).includes(two) ? two : (Operators as readonly string[]).includes(ch) ? ch : null
            if (found === null) return false
            op = found as Operator
            opStart = this.index
            lhs = { kind: "field", ...acc, start, end: this.at() }
            acc.value = ""
            acc.raw = ""
            acc.functions = []
            this.index += found.length
            return true
        })
        if (!closed) this.error(`Function ${ref.fn.name} is missing brace closure`, "missing-closure")
        if (op !== null) {
            const rhs: Field = { kind: "field", ...acc, start: opStart! + (op as string).length, end: this.at() }
            return { kind: "condition", op, lhs: lhs!, rhs, opStart, start, end: this.at() }
        }
        return { kind: "condition", op: "unknown", lhs: { kind: "field", ...acc, start, end: this.at() }, rhs: null, opStart: null, start, end: this.at() }
    }
}

export function placeholder(index: number) {
    return `[SYSTEM_FUNCTION(${index})]`
}

/**
 * Parses ForgeScript code the way ForgeScript compiles it.
 *
 * Strict (default): throws a {@link CompileError} at the first error, where ForgeScript does.
 * `recover: true`: records every error in `errors` and keeps going; without errors the tree is the
 * same as in strict mode.
 */
export function parse(code: string, table: FunctionTable, options: ParseOptions = {}): ParseResult {
    return new Compiler(code, table, !!options.recover).compile()
}

/**
 * Fills a template's placeholders in order of appearance, dropping backslashes right before them,
 * as ForgeScript does when it builds a command's text (`Compiler.wrap`).
 */
export function render(template: string, values: readonly unknown[]): string {
    let i = 0
    return template.replace(PlaceholderRegex, () => {
        const v = values[i++]
        return v === undefined || v === null ? "" : String(v)
    })
}

/** Every call, outer before inner, in source order. */
export function* walk(calls: readonly Call[]): Generator<Call> {
    for (const call of calls) {
        yield call
        for (const field of call.fields ?? []) {
            if (field.kind === "field") yield* walk(field.functions)
            else {
                yield* walk(field.lhs.functions)
                if (field.rhs) yield* walk(field.rhs.functions)
            }
        }
    }
}
