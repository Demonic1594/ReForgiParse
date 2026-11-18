// SPDX-License-Identifier: LGPL-3.0-or-later
//
// ReForgiParse's checks on one file's text, with no file access and no ForgeScript needed: for an
// editor extension, a browser, or any tool that has the text and the functions. The command line
// and the language server use the same function.
//
//   const { checkScript, FunctionTable } = require("reforgiparse/core")
//   const table = FunctionTable.fromMetadata(extensionFunctions, forgeScriptFunctions)
//   checkScript(text, table) // [{ line, column, endLine, endColumn, severity, rule, message, ... }]

import { Level } from "./config"
import { directivesIn, isSuppressed } from "./directives"
import { CodeSource, cook, DYNAMIC, extractCode, fileOffset, lineColumn, regexCanStart, skipRegex } from "./extract"
import { checkCode, distance, Rules, Severity } from "./rules"
import { FunctionTable } from "./table"
import { ValueChecker } from "./values"

/** One problem, at a place in a file. */
export interface Diagnostic {
    /** Relative to the project's root, `/`-separated. */
    file: string
    /** 1-based. */
    line: number
    /** 1-based. */
    column: number
    endLine: number
    endColumn: number
    severity: Severity
    /** A rule of {@link Rules}, or one of {@link ProjectRules}. */
    rule: string
    message: string
}

/** Rules that need the whole file, not only the code: what they find and their default level. */
export const ProjectRules = {
    "unknown-event": { severity: "error", description: "A command's `type` that no loaded package has as an event: the command never runs." },
    "unreadable-string": { severity: "warning", description: "A `code:` string JavaScript would not end where it seems to: it is not checked." },
    "unknown-rule": { severity: "warning", description: "A `reforgiparse-disable` comment that names no rule: it turns nothing off." },
} as const

export interface ScriptOptions {
    /** The file's path, as reported in each diagnostic (and to find custom functions in a `functions` folder). */
    file?: string
    /** Properties whose strings are code (default `["code"]`). */
    properties?: string[]
    /** Checks literal argument values with the bot's ForgeScript (see `ValueChecker`). */
    values?: ValueChecker
    /** Event names a command's `type` can be; without them, types are not checked. */
    events?: ReadonlySet<string> | null
    /** Levels from the config: `error`, `warning`, `info` or `off` per rule. */
    rules?: Record<string, Level>
}

/** Every problem in one JavaScript or TypeScript file's text, with directives and levels applied. */
export function checkScript(text: string, table: FunctionTable, options: ScriptOptions = {}): Diagnostic[] {
    const file = options.file ?? ""
    const properties = options.properties?.length ? options.properties : ["code"]
    const found: Diagnostic[] = []
    const objects = objectLiterals(text)
    for (const src of extractCode(text, properties)) found.push(...checkSource(text, file, src, objects, table, options))

    // Comments that turn rules off; one that names no rule is reported (forgelint- ones may name ForgeLint's rules).
    const directives = directivesIn(text)
    for (const d of directives) {
        if (d.prefix !== "reforgiparse") continue
        for (const rule of d.rules) {
            if (rule in Rules || rule in ProjectRules) continue
            const guess = closest(rule, [...Object.keys(Rules), ...Object.keys(ProjectRules)])
            found.push({ file, line: d.line, column: d.column, endLine: d.line, endColumn: d.column + 1, severity: "warning", rule: "unknown-rule", message: `reforgiparse-${d.kind} names "${rule}", which is not a rule, so it turns nothing off${guess ? `. Did you mean "${guess}"?` : ""}` })
        }
    }
    const levels = options.rules ?? {}
    const out: Diagnostic[] = []
    for (const d of found) {
        const level: Level | undefined = levels[d.rule]
        if (level === "off" || isSuppressed(directives, d.line, d.rule)) continue
        out.push(level ? { ...d, severity: level } : d)
    }
    return out.sort((a, b) => a.line - b.line || a.column - b.column)
}

function checkSource(text: string, file: string, src: CodeSource, objects: ObjectLiteral[], table: FunctionTable, options: ScriptOptions): Diagnostic[] {
    const out: Diagnostic[] = []
    const at = (start: number, end: number, severity: Severity, rule: string, message: string) => {
        const a = lineColumn(text, fileOffset(src, start))
        const b = lineColumn(text, end > start ? fileOffset(src, end - 1) + 1 : fileOffset(src, start))
        out.push({ file, line: a.line, column: a.column, endLine: b.line, endColumn: b.column, severity, rule, message })
    }
    const obj = objects.filter((o) => o.start < src.start && src.end <= o.end).pop()
    if (src.error) {
        const a = lineColumn(text, src.start)
        out.push({ file, line: a.line, column: a.column, endLine: a.line, endColumn: a.column + 1, severity: "warning", rule: "unreadable-string", message: `This ${src.property}: string cannot be read to its end (${src.error}), so it was not checked` })
        return out
    }
    // The body of a custom function ({ name, params, code }, or any object in a functions folder) can read the caller's variables.
    const custom = !!obj && (obj.props.has("params") || (file.split("/").slice(0, -1).includes("functions") && obj.props.has("name")))
    for (const f of checkCode(src.value, table, { values: options.values, customFunction: custom })) {
        // A name right before a ${...} may be completed when the bot runs.
        if ((f.rule === "unknown-function" || f.rule === "glued-name") && src.value[f.end] === DYNAMIC) continue
        at(f.start, f.end, f.severity, f.rule, f.message)
    }

    // The command's type, in the same object as its code. Application commands (with `data`) are skipped.
    const type = obj?.props.get("type")
    if (options.events && obj && type && !obj.props.has("data") && !type.dynamic && !type.error && !options.events.has(type.value)) {
        const a = lineColumn(text, type.start)
        const b = lineColumn(text, type.end)
        const guess = closest(type.value, options.events)
        out.push({ file, line: a.line, column: a.column, endLine: b.line, endColumn: b.column, severity: "error", rule: "unknown-event", message: `"${type.value}" is not an event of ForgeScript or its extensions here, so this command never runs${guess ? `. Did you mean "${guess}"?` : ""}` })
    }
    return out
}

/** An object literal `{ ... }` and its own string-valued properties. */
interface ObjectLiteral {
    start: number
    end: number
    /** Every own property; string values are read, others are `null`-valued sources. */
    props: Map<string, CodeSource>
}

/** Every object literal in a file, with its own properties, skipping strings and comments. */
function objectLiterals(text: string): ObjectLiteral[] {
    const out: ObjectLiteral[] = []
    const stack: ObjectLiteral[] = []
    const key = /([A-Za-z_$][\w$]*|"[^"\n]*"|'[^'\n]*')\s*:/y
    let expectKey = false
    for (let i = 0; i < text.length; ) {
        const c = text[i]
        if (c === "/" && (text[i + 1] === "/" || text[i + 1] === "*")) {
            i = text[i + 1] === "/" ? (text.indexOf("\n", i) + 1 || text.length) : (text.indexOf("*/", i + 2) + 2 || text.length)
            continue
        }
        if (/\s/.test(c)) {
            i++
            continue
        }
        if (expectKey && stack.length) {
            key.lastIndex = i
            const m = key.exec(text)
            expectKey = false
            if (m) {
                const name = m[1].replace(/^["']|["']$/g, "")
                let j = key.lastIndex
                while (/\s/.test(text[j] ?? "")) j++
                const q = text[j]
                if (q === '"' || q === "'" || q === "`") {
                    const r = cook(text, j)
                    stack[stack.length - 1].props.set(name, { property: name, value: r.value, offsets: r.offsets, start: j, end: r.end, dynamic: r.dynamic, error: r.error })
                    i = r.end
                } else {
                    stack[stack.length - 1].props.set(name, { property: name, value: "", offsets: [], start: j, end: j, dynamic: true, error: "not a string" })
                    i = j
                }
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
        if (c === "{") {
            const o: ObjectLiteral = { start: i, end: text.length, props: new Map() }
            stack.push(o)
            out.push(o)
            expectKey = true
        } else if (c === "}") {
            const o = stack.pop()
            if (o) o.end = i + 1
        } else if (c === "," && stack.length) expectKey = true
        else if (c === "(" || c === "[") stack.push({ start: -1, end: -1, props: new Map() })
        else if ((c === ")" || c === "]") && stack.length && stack[stack.length - 1].start === -1) stack.pop()
        i++
    }
    return out
}

export function closest(word: string, names: Iterable<string>): string | null {
    let best: string | null = null
    let bestD = Infinity
    for (const n of names) {
        const d = distance(word.toLowerCase(), n.toLowerCase())
        if (d < bestD) (bestD = d), (best = n)
    }
    return bestD <= Math.max(1, Math.floor(word.length / 4)) ? best : null
}

export * from "./table"
export * from "./parser"
export * from "./names"
export * from "./extract"
export * from "./rules"
export * from "./values"
export * from "./fix"
export * from "./directives"
