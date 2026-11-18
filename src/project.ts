// SPDX-License-Identifier: LGPL-3.0-or-later
//
// A bot's ForgeScript, read from its folder: the functions it has (the installed ForgeScript, its
// extensions, its custom functions) and the code in its files, checked together.

import * as fs from "node:fs"
import * as path from "node:path"
import { CodeSource, cook, DYNAMIC, extractCode, fileOffset, lineColumn } from "./extract"
import { Config, ConfigError, Level, loadConfig } from "./config"
import { directivesIn, isSuppressed } from "./directives"
import { checkCode, distance, Rules, Severity } from "./rules"
import { ValueChecker } from "./values"
import { FunctionTable, fromMetadata, IFunctionMetadata, INativeArg, IRawFunction, paramFromNative, storesOf, withParams } from "./table"

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

/** Where a function list came from. */
export interface FunctionSource {
    /** `@tryforge/forgescript`, an extension's package name, or `custom`. */
    name: string
    version: string | null
    functions: number
}

/** Rules that need the whole file, not only the code: what they find and their default level. */
export const ProjectRules = {
    "unknown-event": { severity: "error", description: "A command's `type` that no loaded package has as an event: the command never runs." },
    "unreadable-string": { severity: "warning", description: "A `code:` string JavaScript would not end where it seems to: it is not checked." },
    "unknown-rule": { severity: "warning", description: "A `reforgiparse-disable` comment that names no rule: it turns nothing off." },
} as const

export interface ProjectOptions {
    /** Properties whose string values are ForgeScript code (default: the config's, else `["code"]`). */
    properties?: string[]
    /** Folders or files to check, relative to the root (default: the config's, else the whole root). */
    include?: string[]
    /** The config to use. Default: the bot's own (`reforgiparse.config.json` or package.json). Pass `{}` for none. */
    config?: Config
}

/** Extensions of files that are read. */
const CODE_FILE = /\.(c|m)?(j|t)s$/
/** Skipped at the top of the project only (`commands/docs` is still read). */
const SKIP_AT_TOP = new Set(["dist", "build", "docs", "coverage", "out"])

/** A custom function found in the bot's files (`{ name, params, code }`). */
export interface CustomFunction {
    name: string
    params: Array<string | { name: string; rest?: boolean; required?: boolean }>
    brackets: boolean | undefined
    firstParamCondition: boolean
    file: string
}

export class Project {
    readonly table: FunctionTable
    readonly sources: FunctionSource[]
    readonly customFunctions: CustomFunction[]
    /** What could not be read; shown, never fatal. */
    readonly notes: string[]
    /** Checks literal argument values with the bot's ForgeScript. */
    readonly values: ValueChecker
    /** Event names a command's `type` can be, `null` when ForgeScript's could not be read. */
    readonly events: Set<string> | null

    private constructor(
        readonly root: string,
        readonly files: string[],
        readonly properties: string[],
        readonly config: Config,
        loaded: { table: FunctionTable; sources: FunctionSource[]; custom: CustomFunction[]; notes: string[]; events: Set<string> | null; values: ValueChecker },
    ) {
        this.values = loaded.values
        this.events = loaded.events
        this.table = loaded.table
        this.sources = loaded.sources
        this.customFunctions = loaded.custom
        this.notes = loaded.notes
    }

    /** Reads a bot's folder: its `package.json`, installed packages and code files. */
    static load(root: string, options: ProjectOptions = {}): Project {
        root = path.resolve(root)
        const config = options.config ?? loadConfig(root).config
        for (const rule of Object.keys(config.rules ?? {})) {
            if (!(rule in Rules) && !(rule in ProjectRules)) {
                const guess = closest(rule, [...Object.keys(Rules), ...Object.keys(ProjectRules)])
                throw new ConfigError("config", `"rules" names "${rule}", which is not a rule${guess ? ` (did you mean "${guess}"?)` : ""}. See reforgiparse --rules`)
            }
        }
        const properties = options.properties?.length ? options.properties : config.properties?.length ? config.properties : ["code"]
        const exclude = config.exclude ?? []
        const include = options.include?.length ? options.include : config.include?.length ? config.include : ["."]
        const files = include.flatMap((p) => listFiles(root, path.resolve(root, p), exclude))
        const notes: string[] = []
        const sources: FunctionSource[] = []
        const raw: IRawFunction[] = []
        const seen = new Set<string>()
        const extensionEvents: string[] = []
        let events: Set<string> | null = null
        const add = (fns: IRawFunction[], source: FunctionSource) => {
            let n = 0
            for (const f of fns) {
                if (seen.has(f.name)) continue
                seen.add(f.name)
                raw.push(f)
                n++
            }
            sources.push({ ...source, functions: n })
        }

        const forgeDir = packageDir(root, "@tryforge/forgescript")
        let forgescript: any = null
        if (forgeDir) {
            try {
                forgescript = require(forgeDir)
            } catch (e) {
                notes.push(`cannot load @tryforge/forgescript (${(e as Error).message})`)
            }
        } else notes.push("@tryforge/forgescript is not installed here: every function name is unknown (run npm install)")
        const tag = (fns: IRawFunction[], pkg: string) => fns.map((f) => ({ ...f, package: f.package ?? pkg }))

        // As in a bot: the extensions' functions first, then ForgeScript's own, which skips names already taken.
        for (const dep of dependencies(root)) {
            if (dep === "@tryforge/forgescript") continue
            const dir = packageDir(root, dep)
            if (!dir || !usesForgeScript(dir)) continue
            const meta = path.join(dir, "metadata", "functions.json")
            if (!fs.existsSync(meta)) {
                // No metadata (the official extensions on npm): read its NativeFunction files instead.
                const natives = readNatives(dir, forgescript?.ArgType)
                extensionEvents.push(...natives.events)
                for (const f of natives.failures) notes.push(`${dep}: ${f}`)
                if (natives.functions.length) add(tag(natives.functions, dep), { name: dep, version: version(dir), functions: 0 })
                else notes.push(`${dep} has no metadata/functions.json and no readable NativeFunction files: its functions are unknown`)
                continue
            }
            const ev = readJson(path.join(dir, "metadata", "events.json"))
            if (Array.isArray(ev)) extensionEvents.push(...ev.map((e: { name?: string } | string) => (typeof e === "string" ? e : e.name ?? "")))
            try {
                const list = JSON.parse(fs.readFileSync(meta, "utf8")) as IFunctionMetadata[]
                add(tag(list.map(fromMetadata), dep), { name: dep, version: version(dir), functions: 0 })
            } catch (e) {
                notes.push(`${dep}: cannot read metadata/functions.json (${(e as Error).message})`)
            }
        }
        if (forgescript) {
            try {
                forgescript.FunctionManager.loadNative()
                add(withParams(forgescript), { name: "@tryforge/forgescript", version: version(forgeDir!), functions: 0 })
                const native = forgeScriptEvents(forgeDir!)
                if (native) events = new Set([...native, ...extensionEvents])
            } catch (e) {
                notes.push(`cannot read ForgeScript's functions (${(e as Error).message})`)
            }
        }

        // Custom functions are added last, and replace a function of the same name, as FunctionManager.add does.
        // Read from the whole bot, even when only some files are checked: they call functions defined elsewhere.
        const everyFile = include.length === 1 && include[0] === "." ? files : listFiles(root, root, exclude)
        const custom = everyFile.flatMap((f) => customFunctions(root, f, properties))
        for (const c of custom) {
            const fn = customAsRaw(c)
            const i = raw.findIndex((x) => x.name.toLowerCase() === fn.name.toLowerCase())
            if (i >= 0) raw[i] = fn
            else raw.push(fn)
        }
        if (custom.length) sources.push({ name: "custom", version: null, functions: custom.length })
        // Names the config says exist (made when the bot runs): any arguments, and unknown use of variables.
        for (const k of config.known ?? []) {
            const name = k.startsWith("$") ? k : `$${k}`
            if (!raw.some((x) => x.name.toLowerCase() === name.toLowerCase())) raw.push({ name, aliases: null, args: { required: false, fields: [{ rest: true }] }, package: "known" })
        }
        if (config.known?.length) sources.push({ name: "known (config)", version: null, functions: config.known.length })
        let discord: any = null
        try {
            discord = forgeDir ? require(require.resolve("discord.js", { paths: [forgeDir] })) : null
        } catch {
            // Colour names are then not known: only hex and numbers are taken as colours.
        }
        const values = new ValueChecker(forgescript, discord)
        return new Project(root, files, properties, config, { table: new FunctionTable(raw), sources, custom, notes, events, values })
    }

    /** Checks every file. */
    check(): Diagnostic[] {
        return this.files.flatMap((f) => this.checkFile(f))
    }

    /** Checks one file (absolute, or relative to the root). */
    checkFile(file: string): Diagnostic[] {
        const abs = path.resolve(this.root, file)
        const text = fs.readFileSync(abs, "utf8")
        const rel = path.relative(this.root, abs).split(path.sep).join("/")
        const found: Diagnostic[] = []
        const objects = objectLiterals(text)
        for (const src of extractCode(text, this.properties)) found.push(...this.checkSource(text, rel, src, objects))

        // Comments that turn rules off; one that names no rule is reported (forgelint- ones may name ForgeLint's rules).
        const directives = directivesIn(text)
        for (const d of directives) {
            if (d.prefix !== "reforgiparse") continue
            for (const rule of d.rules) {
                if (rule in Rules || rule in ProjectRules) continue
                const guess = closest(rule, [...Object.keys(Rules), ...Object.keys(ProjectRules)])
                found.push({ file: rel, line: d.line, column: d.column, endLine: d.line, endColumn: d.column + 1, severity: "warning", rule: "unknown-rule", message: `reforgiparse-${d.kind} names "${rule}", which is not a rule, so it turns nothing off${guess ? `. Did you mean "${guess}"?` : ""}` })
            }
        }
        const levels = this.config.rules ?? {}
        const out: Diagnostic[] = []
        for (const d of found) {
            const level: Level | undefined = levels[d.rule]
            if (level === "off" || isSuppressed(directives, d.line, d.rule)) continue
            out.push(level ? { ...d, severity: level } : d)
        }
        return out.sort((a, b) => a.line - b.line || a.column - b.column)
    }

    private checkSource(text: string, file: string, src: CodeSource, objects: ObjectLiteral[]): Diagnostic[] {
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
        for (const f of checkCode(src.value, this.table, { values: this.values, customFunction: custom })) {
            // A name right before a ${...} may be completed when the bot runs.
            if ((f.rule === "unknown-function" || f.rule === "glued-name") && src.value[f.end] === DYNAMIC) continue
            at(f.start, f.end, f.severity, f.rule, f.message)
        }

        // The command's type, in the same object as its code. Application commands (with `data`) are skipped.
        const type = obj?.props.get("type")
        if (this.events && obj && type && !obj.props.has("data") && !type.dynamic && !type.error && !this.events.has(type.value)) {
            const a = lineColumn(text, type.start)
            const b = lineColumn(text, type.end)
            const guess = closest(type.value, this.events)
            out.push({ file, line: a.line, column: a.column, endLine: b.line, endColumn: b.column, severity: "error", rule: "unknown-event", message: `"${type.value}" is not an event of ForgeScript or its extensions here, so this command never runs${guess ? `. Did you mean "${guess}"?` : ""}` })
        }
        return out
    }
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

/**
 * The functions and event names an extension defines in code: its `NativeFunction` files and event
 * handlers, loaded without starting the extension. Only files that mention them are loaded.
 */
export function readNatives(dir: string, argType?: Record<number, string>): { functions: IRawFunction[]; events: string[]; failures: string[] } {
    const functions: IRawFunction[] = []
    const events: string[] = []
    const failures: string[] = []
    const seen = new Set<string>()
    const visit = (d: string) => {
        let entries: fs.Dirent[] = []
        try {
            entries = fs.readdirSync(d, { withFileTypes: true })
        } catch {
            return
        }
        for (const e of entries) {
            const p = path.join(d, e.name)
            if (e.isDirectory()) {
                if (e.name !== "node_modules" && !e.name.startsWith(".")) visit(p)
                continue
            }
            if (!/\.c?js$/.test(e.name)) continue
            const text = fs.readFileSync(p, "utf8")
            const native = text.includes("NativeFunction")
            const handler = text.includes("EventHandler")
            if (!native && !handler) continue
            let item: any
            try {
                const exported = require(p)
                item = exported?.default ?? exported
            } catch (err) {
                failures.push(`cannot load ${path.relative(dir, p)} (${(err as Error).message})`)
                continue
            }
            const data = item?.data
            if (native && data && typeof data.name === "string" && data.name.startsWith("$")) {
                if (seen.has(data.name)) continue
                seen.add(data.name)
                const args: INativeArg[] = data.args ?? []
                functions.push({
                    name: data.name,
                    aliases: data.aliases ?? null,
                    args: data.brackets === undefined ? null : { required: data.brackets, fields: args.map((a) => ({ condition: !!a.condition, rest: !!a.rest })) },
                    params: args.map((a) => paramFromNative(a, argType)),
                    unwrap: !!data.unwrap && args.length > 0,
                    deprecated: !!data.deprecated,
                    stores: storesOf(p),
                })
            } else if (handler && item && typeof item.name === "string" && typeof item.register === "function") events.push(item.name)
        }
    }
    visit(fs.existsSync(path.join(dir, "dist")) ? path.join(dir, "dist") : dir)
    return { functions, events, failures }
}

/** The events ForgeScript has: the handler files in its `handlers/events` folder. */
function forgeScriptEvents(forgeDir: string): string[] | null {
    const dir = path.join(forgeDir, "dist", "handlers", "events")
    if (!fs.existsSync(dir)) return null
    const out: string[] = []
    for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith(".js")) continue
        try {
            const name = require(path.join(dir, f)).default?.name
            if (typeof name === "string") out.push(name)
        } catch {
            // A handler that cannot be loaded is left out.
        }
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


function listFiles(root: string, start: string, exclude: readonly string[] = []): string[] {
    if (!fs.existsSync(start)) return []
    const rel = (p: string) => path.relative(root, p).split(path.sep).join("/")
    const clean = (x: string) => x.replace(/^\.\//, "").replace(/\/$/, "")
    const excluded = (p: string, name: string) => exclude.some((x) => x === name || clean(x) === rel(p))
    if (fs.statSync(start).isFile()) return CODE_FILE.test(start) && !start.endsWith(".d.ts") && !excluded(start, path.basename(start)) ? [start] : []
    const out: string[] = []
    const visit = (dir: string) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
            if (e.name === "node_modules" || e.name.startsWith(".")) continue
            const p = path.join(dir, e.name)
            if (excluded(p, e.name)) continue
            if (e.isDirectory()) {
                if (dir === root && SKIP_AT_TOP.has(e.name)) continue
                visit(p)
            } else if (e.isFile() && CODE_FILE.test(e.name) && !e.name.endsWith(".d.ts")) out.push(p)
        }
    }
    visit(start)
    return out
}

function dependencies(root: string): string[] {
    try {
        const pj = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))
        return Object.keys({ ...pj.dependencies, ...pj.devDependencies, ...pj.optionalDependencies })
    } catch {
        return []
    }
}

function packageDir(root: string, name: string): string | null {
    for (let d = root; ; d = path.dirname(d)) {
        const p = path.join(d, "node_modules", name)
        if (fs.existsSync(path.join(p, "package.json"))) return p
        if (path.dirname(d) === d) return null
    }
}

function readJson(file: string): any {
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"))
    } catch {
        return null
    }
}

function version(dir: string): string | null {
    return readJson(path.join(dir, "package.json"))?.version ?? null
}

function usesForgeScript(dir: string): boolean {
    const pj = readJson(path.join(dir, "package.json"))
    return !!pj && ["dependencies", "peerDependencies", "devDependencies"].some((k) => pj[k] && "@tryforge/forgescript" in pj[k])
}

/**
 * Custom functions written as `{ name: "...", params: [...], code: "..." }` in the bot's files.
 * Read from the text, not run: names, params, `brackets` and `firstParamCondition` must be literals.
 */
function customFunctions(root: string, file: string, properties: string[]): CustomFunction[] {
    const text = fs.readFileSync(file, "utf8")
    // In a `functions` folder every { name, code } is a custom function; elsewhere only those with params.
    const inFunctionsFolder = path.relative(root, file).split(path.sep).slice(0, -1).includes("functions")
    if (!inFunctionsFolder && !/\bparams\s*:/.test(text)) return []
    const names = extractCode(text, ["name", ...properties]).filter((s) => s.property === "name" && !s.dynamic && !s.error)
    const out: CustomFunction[] = []
    names.forEach((s, k) => {
        const seg = text.slice(s.end, k + 1 < names.length ? names[k + 1].start : text.length)
        const pm = /\bparams\s*:\s*\[/.exec(seg)
        if (!pm && !inFunctionsFolder) return
        const params: CustomFunction["params"] = []
        let body = ""
        if (pm) {
            let j = pm.index + pm[0].length - 1
            for (let depth = 0; j < seg.length; j++) {
                if (seg[j] === "[") depth++
                else if (seg[j] === "]" && --depth === 0) break
            }
            body = seg.slice(pm.index + pm[0].length, j)
        }
        for (const m of body.matchAll(/\{[^{}]*\}|(["'`])(\w+)\1/g)) {
            if (m[0].startsWith("{")) {
                const nm = /name\s*:\s*["'`](\w+)/.exec(m[0])
                if (nm) params.push({ name: nm[1], rest: /rest\s*:\s*true/.test(m[0]), required: !/required\s*:\s*false/.test(m[0]) })
            } else params.push(m[2])
        }
        const b = /\bbrackets\s*:\s*(true|false)/.exec(seg)
        out.push({
            name: s.value.replace(/^\$/, ""),
            params,
            brackets: b ? b[1] === "true" : undefined,
            firstParamCondition: /\bfirstParamCondition\s*:\s*true/.test(seg),
            file: path.relative(root, file).split(path.sep).join("/"),
        })
    })
    return out
}

/** A custom function as the compiler sees it (`ForgeFunction.asNative`, then `FunctionManager.raw`). */
export function customAsRaw(c: Pick<CustomFunction, "name" | "params" | "brackets" | "firstParamCondition">): IRawFunction {
    const brackets = c.brackets ?? (c.params.length ? true : undefined)
    return {
        name: `$${c.name}`,
        aliases: null,
        args:
            brackets === undefined
                ? null
                : {
                      required: brackets,
                      fields: c.params.map((p, i) => ({ rest: typeof p === "string" ? false : !!p.rest, condition: i === 0 && c.firstParamCondition })),
                  },
        params: c.params.map((p) => (typeof p === "string" ? { name: p, required: true, rest: false } : { name: p.name, required: p.required ?? true, rest: !!p.rest })),
        unwrap: c.params.length > 0 && !c.firstParamCondition,
        package: "custom",
    }
}
