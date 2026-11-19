// SPDX-License-Identifier: LGPL-3.0-or-later
//
// A bot's ForgeScript, read from its folder: the functions it has (the installed ForgeScript, its
// extensions, its custom functions) and the code in its files, checked together.

export { Diagnostic, ProjectRules } from "./core"

import * as fs from "node:fs"
import * as path from "node:path"
import { checkRuleNames, Config, loadConfig } from "./config"
import { checkScript, Diagnostic } from "./core"
import { extractCode } from "./extract"
import { EventSite, eventSites, Outcome, packageSources, probeExtensions, readsEventData } from "./events"
import { EventModel } from "./rules"
import { ValueChecker } from "./values"
import { eventDataOf, FunctionTable, fromMetadata, IFunctionMetadata, INativeArg, IRawFunction, outputNames, paramFromNative, resolvedArgsOf, storesOf, withParams } from "./table"

/** Where a function list came from. */
export interface FunctionSource {
    /** `@tryforge/forgescript`, an extension's package name, or `custom`. */
    name: string
    version: string | null
    functions: number
}

export interface ProjectOptions {
    /** Properties whose string values are ForgeScript code (default: the config's, else `["code"]`). */
    properties?: string[]
    /** Folders or files to check, relative to the root (default: the config's, else the whole root). */
    include?: string[]
    /** The config to use. Default: the bot's own (`reforgiparse.config.json` or package.json). Pass `{}` for none. */
    config?: Config
}

/** This package's name, as a bot lists it among its dependencies. */
const SELF: string = require("../package.json").name

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
    /** What each of ForgeScript's events gives a command's code, read from its handlers. */
    readonly eventModel: Map<string, EventModel> | null

    private constructor(
        readonly root: string,
        readonly files: string[],
        readonly properties: string[],
        readonly config: Config,
        loaded: { table: FunctionTable; sources: FunctionSource[]; custom: CustomFunction[]; notes: string[]; events: Set<string> | null; values: ValueChecker; eventModel: Map<string, EventModel> | null },
    ) {
        this.eventModel = loaded.eventModel
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
        // A config passed in code is checked too (one read from a file already was, with its path).
        if (options.config) checkRuleNames(options.config.rules, "the config passed to Project.load")
        const properties = options.properties?.length ? options.properties : config.properties?.length ? config.properties : ["code"]
        const exclude = config.exclude ?? []
        const include = options.include?.length ? options.include : config.include?.length ? config.include : ["."]
        const files = include.flatMap((p) => listFiles(root, path.resolve(root, p), exclude))
        const notes: string[] = []
        const sources: FunctionSource[] = []
        const raw: IRawFunction[] = []
        const seen = new Set<string>()
        sourceCache.clear()
        const extensionEvents: string[] = []
        // Each extension's folder and events: what its events give a command, and its functions read.
        const extensions: Array<{ name: string; dir: string; events: string[] }> = []
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
            // ReForgiParse depends on ForgeScript too, but is no extension: it has no functions to add.
            if (dep === "@tryforge/forgescript" || dep === SELF) continue
            const dir = packageDir(root, dep)
            if (!dir || !usesForgeScript(dir)) continue
            const meta = path.join(dir, "metadata", "functions.json")
            if (!fs.existsSync(meta)) {
                // No metadata (the official extensions on npm): read its NativeFunction files instead.
                const natives = readNatives(dir, forgescript?.ArgType)
                extensionEvents.push(...natives.events)
                extensions.push({ name: dep, dir, events: natives.events })
                for (const f of natives.failures) notes.push(`${dep}: ${f}`)
                if (natives.functions.length) add(tag(natives.functions, dep), { name: dep, version: version(dir), functions: 0 })
                else notes.push(`${dep} has no metadata/functions.json and no readable NativeFunction files: its functions are unknown`)
                continue
            }
            const ev = readJson(path.join(dir, "metadata", "events.json"))
            const evNames = Array.isArray(ev) ? ev.map((e: { name?: string } | string) => (typeof e === "string" ? e : e.name ?? "")).filter(Boolean) : []
            extensionEvents.push(...evNames)
            extensions.push({ name: dep, dir, events: evNames })
            try {
                const list = JSON.parse(fs.readFileSync(meta, "utf8")) as IFunctionMetadata[]
                add(tag(list.map(fromMetadata), dep), { name: dep, version: version(dir), functions: 0 })
            } catch (e) {
                notes.push(`${dep}: cannot read metadata/functions.json (${(e as Error).message})`)
            }
        }
        if (forgescript) {
            try {
                // Once per process: loading them again (the language server reads the bot on every save) makes ForgeScript warn.
                if (!forgescript.FunctionManager.get?.("$ping")) forgescript.FunctionManager.loadNative()
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
            const fn = { ...customAsRaw(c), description: `A custom function, in ${c.file}` }
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
        const eventModel = forgeDir ? forgeScriptEventModel(forgeDir) : null
        const probes = forgeDir && config.probe !== false ? probeEvents(forgeDir, extensions) : extensions.map(() => null)
        for (const [i, ext] of extensions.entries()) {
            const scan = scanExtension(ext.dir)
            const probed = probes[i]
            for (const f of raw) {
                if (f.package !== ext.name || f.context) continue
                f.context = probed ? probed.get(f.name.toLowerCase()) : scan.functions.get(f.name.toLowerCase())
            }
            if (!eventModel) continue
            const sources = sourcesOf(ext.dir)
            for (const name of ext.events) {
                const mine: EventModel = { name, packages: [ext.name], interaction: true, states: eventStates(eventSites(sources, name)) ?? scan.states, words: scan.words }
                const other = eventModel.get(name)
                eventModel.set(name, other ? mergeEvents(other, mine) : mine)
            }
        }
        return new Project(root, files, properties, config, { table: new FunctionTable(raw), sources, custom, notes, events, values, eventModel })
    }

    /** Checks every file. */
    check(): Diagnostic[] {
        return this.files.flatMap((f) => this.checkFile(f))
    }

    /** Checks one file (absolute, or relative to the root). */
    checkFile(file: string): Diagnostic[] {
        const abs = path.resolve(this.root, file)
        const rel = path.relative(this.root, abs).split(path.sep).join("/")
        return checkScript(fs.readFileSync(abs, "utf8"), this.table, { file: rel, properties: this.properties, values: this.values, events: this.events, rules: this.config.rules, eventModel: this.eventModel })
    }
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
                    resolved: data.unwrap ? undefined : resolvedArgsOf(p, args.length),
                    description: typeof data.description === "string" ? data.description : undefined,
                    output: outputNames(data.output, argType),
                })
            } else if (handler && item && typeof item.name === "string" && typeof item.register === "function") events.push(item.name)
        }
    }
    visit(fs.existsSync(path.join(dir, "dist")) ? path.join(dir, "dist") : dir)
    return { functions, events, failures }
}

/**
 * What each of ForgeScript's events gives a command's code, from its handler's source: the states it
 * sets (`states: { message: ... }`), whether it gives message words (`args` other than `[]`), and an
 * interaction (interactionCreate, whose handler runs commands with the interaction).
 */
export function forgeScriptEventModel(forgeDir: string): Map<string, EventModel> | null {
    const dir = path.join(forgeDir, "dist", "handlers", "events")
    if (!fs.existsSync(dir)) return null
    const out = new Map<string, EventModel>()
    for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith(".js")) continue
        const text = fs.readFileSync(path.join(dir, f), "utf8")
        const name = /name: "([A-Za-z]+)"/.exec(text)?.[1]
        if (!name) continue
        const states = new Set<string>()
        const block = /states: \{([\s\S]*?)\n {16}\},/.exec(text)?.[1] ?? ""
        for (const m of block.matchAll(/^ {20}([a-zA-Z]+): \{/gm)) states.add(m[1])
        const args = /\bargs(:\s*([^,\n]+))?,/.exec(text)
        out.set(name, { name, packages: ["@tryforge/forgescript"], interaction: name === "interactionCreate", states, words: !!args && args[2]?.trim() !== "[]" })
    }
    return out
}

/**
 * Each extension's functions that read its events' data, found by running them (one child process for all, {@link probeExtensions}):
 * those that give something with one of its events' data and nothing (or a TypeError) without, with
 * what they give in each of its events. `null` when the probe could not run.
 */
function probeEvents(forgeDir: string, extensions: Array<{ name: string; dir: string; events: string[] }>): Array<Map<string, IRawFunction["context"]> | null> {
    const scanned = extensions.map((ext) => {
        const sources = sourcesOf(ext.dir)
        const functions = sources
            .filter((s) => s.text.includes("NativeFunction") && readsEventData(s.text, sources))
            .map((s) => ({ name: /\bname:\s*["'](\$[A-Za-z0-9_]+)["']/.exec(s.text)?.[1] ?? "", file: s.file }))
            .filter((f) => f.name)
        return { ext, sources, functions }
    })
    if (!scanned.some((s) => s.functions.length)) return extensions.map(() => new Map())
    // Every extension's events, each function is run in: its own and the others' ("package|event").
    const events: Record<string, EventSite[]> = {}
    for (const s of scanned) for (const e of s.ext.events) events[`${s.ext.name}|${e}`] = eventSites(s.sources, e)
    const results = probeExtensions(forgeDir, scanned.map((s) => ({ functions: s.functions, events: s.functions.length ? events : {} })))
    return scanned.map((s, i) => {
        if (!s.functions.length) return new Map()
        const result = results?.[i]
        if (!result) return null
        const out = new Map<string, IRawFunction["context"]>()
        for (const [name, r] of Object.entries(result)) {
            if (r.none === "value" || r.none === "unknown") continue
            const own = Object.entries(r.events).filter(([k]) => k.startsWith(`${s.ext.name}|`))
            // Data it reads in one of its own events, or its events' data cannot be read from source.
            if (!own.some(([, o]) => o === "value") && !own.every(([, o]) => o === "unknown")) continue
            // Per event name: missing only when it is in every package that has an event of that name.
            const byName = new Map<string, Outcome[]>()
            for (const [key, o] of Object.entries(r.events)) {
                const event = key.slice(key.indexOf("|") + 1)
                byName.set(event, [...(byName.get(event) ?? []), o])
            }
            const missing: Record<string, string | null> = {}
            for (const [event, outcomes] of byName) {
                if (outcomes.every((o) => o === "nothing")) missing[event] = null
                else if (outcomes.every((o) => typeof o === "object")) missing[event] = (outcomes[0] as { crash: string }).crash
            }
            const givenIn = own.filter(([, o]) => o === "value").map(([k]) => k.slice(k.indexOf("|") + 1))
            out.set(name, { event: true, crash: typeof r.none === "object" ? r.none.crash : undefined, missingIn: missing, givenIn })
        }
        return out
    })
}

/** An extension's files, read once per load of a project. */
const sourceCache = new Map<string, ReturnType<typeof packageSources>>()
function sourcesOf(dir: string) {
    let out = sourceCache.get(dir)
    if (!out) sourceCache.set(dir, (out = packageSources(dir)))
    return out
}

/**
 * The states an extension's event gives its commands, from how its handler runs them: `undefined` when
 * that is not known (no site), `null` when a site's states cannot be read.
 */
function eventStates(sites: EventSite[]): Set<string> | null | undefined {
    if (!sites.length) return undefined
    const out = new Set<string>()
    for (const site of sites) {
        if (site.states === null) return null
        if (site.states?.kind === "object") for (const k of Object.keys(site.states.keys)) out.add(k)
        else if (site.states && site.states.kind !== "none") return null
    }
    return out
}

/** Two events of one name, from two packages: what either may give. */
function mergeEvents(a: EventModel, b: EventModel): EventModel {
    return {
        name: a.name,
        packages: [...a.packages, ...b.packages],
        interaction: a.interaction || b.interaction,
        states: a.states && b.states ? new Set([...a.states, ...b.states]) : null,
        words: a.words || b.words,
    }
}

/**
 * What an extension's events give a command, and what its functions read, from its source:
 * - the states its code passes when it runs a command (`states: { giveaway: ... }`), `null` when one is
 *   not written out where it is passed;
 * - whether it passes a message command's words (`args`);
 * - its functions that read only its own events' data ({@link eventDataOf}).
 */
export function scanExtension(dir: string): { states: Set<string> | null; words: boolean; functions: Map<string, IRawFunction["context"]> } {
    let states: Set<string> | null = new Set<string>()
    let words = false
    const functions = new Map<string, IRawFunction["context"]>()
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
            if (text.includes("NativeFunction")) {
                const name = /\bname:\s*["'](\$[A-Za-z0-9_]+)["']/.exec(text)?.[1]
                const context = name ? eventDataOf(text) : undefined
                if (name && context) functions.set(name.toLowerCase(), context)
                continue
            }
            if (!/Interpreter\.run\(|Context\(/.test(text)) continue
            for (const m of text.matchAll(/(?<![\w.$])states\s*([:,}\n])/g)) {
                if (!states) break
                const after = text.slice(m.index! + m[0].length)
                if (m[1] !== ":" || !/^\s*\{/.test(after)) {
                    states = null
                    break
                }
                const keys = objectKeys(after.slice(after.indexOf("{")))
                if (keys) for (const k of keys) states.add(k)
                else states = null
            }
            if (/(?<![\w.$])args\s*[:,}]/.test(text)) words = true
        }
    }
    visit(fs.existsSync(path.join(dir, "dist")) ? path.join(dir, "dist") : dir)
    return { states, words, functions }
}

/** The keys of the object literal `text` starts with, `null` when one is not a plain name (a spread...). */
function objectKeys(text: string): string[] | null {
    const keys: string[] = []
    let depth = 0
    for (let i = 0; i < text.length; i++) {
        const c = text[i]
        if (c === "{" || c === "[" || c === "(") depth++
        else if (c === "}" || c === "]" || c === ")") {
            if (--depth === 0) return keys
        } else if (depth === 1 && /[A-Za-z_$.]/.test(c) && /[{,]\s*$/.test(text.slice(0, i))) {
            const m = /^([A-Za-z_$][\w$]*)\s*[:,}]/.exec(text.slice(i))
            if (!m) return null
            keys.push(m[1])
            i += m[1].length - 1
        }
    }
    return null
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
