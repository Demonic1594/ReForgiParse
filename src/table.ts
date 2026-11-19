// SPDX-License-Identifier: LGPL-3.0-or-later
//
// The function table: what ForgeScript's compiler knows about each function, and the regular
// expression it finds calls with. Mirrors Compiler.setFunctions() and FunctionManager.raw in
// ForgeScript (github.com/tryforge/ForgeScript, LGPL-3.0-or-later).

/** One argument as the compiler sees it. */
export interface IRawField {
    /** The field is a condition (`$if[a==b;...]`): an operator splits it in two. */
    condition?: boolean
    /** The field takes every remaining argument. */
    rest?: boolean
}

/** An argument as documented: what usage hints and argument checks need. */
export interface IParam {
    name: string
    required?: boolean
    rest?: boolean
    /** The ArgType name: `String`, `Number`, `Boolean`, `Time`, `Enum`, `User`, ... */
    type?: string
    /** For an `Enum`: its value names. */
    enum?: readonly string[]
    /** For an `Enum` from a NativeFunction: the enum itself, which ForgeScript looks the text up in (names and, for a numeric enum, its numbers). */
    enumObject?: Readonly<Record<string, string | number>>
}

/** A function as ForgeScript's compiler sees it (the shape of `FunctionManager.raw`), with its documented arguments when known. */
export interface IRawFunction {
    /** With the `$`, as registered, e.g. `$sendMessage`. */
    name: string
    aliases?: readonly string[] | null
    /** `null`: the function takes no brackets, and a `[` after it is plain text. */
    args: {
        /** Brackets are required (`$ping` alone is an error when true). */
        required: boolean
        fields: readonly IRawField[]
    } | null
    /** The documented arguments, in order. Not used by the parser; `undefined` when unknown. */
    params?: readonly IParam[]
    /** ForgeScript resolves the arguments before running the function (and so rejects missing ones). */
    unwrap?: boolean
    deprecated?: boolean
    /** Where it comes from: `@tryforge/forgescript`, an extension's package name, or `custom`. */
    package?: string
    /** What it does with the two variable stores, read from its source when known. */
    stores?: { setsVariable?: boolean; readsVariable?: boolean; setsEnvironment?: boolean }
    /**
     * For a function that reads its own arguments (not `unwrap`): the positions it sends through
     * ForgeScript's argument check (`resolveMultipleArgs`, `resolveUnhandledArg`), in the order it
     * does, read from its source. `undefined` when unknown.
     */
    resolved?: readonly number[]
    /** What it does, as its package documents it. */
    description?: string
    /** The ArgType names of what it returns, when documented. */
    output?: readonly string[]
}

/** Escapes a name the way ForgeScript does before joining names into one regular expression. */
const ESCAPE = /(\.|\$|\(|\)|\*|\[|\]|\{|\}|\?|!|\^)/gim

/**
 * The functions a bot has, in the order ForgeScript registers them. A later name or alias replaces
 * the earlier function but keeps its place, as `Collection.set` does.
 */
export class FunctionTable {
    /** Lower-case name or alias, with `$`, to the function. */
    readonly byKey = new Map<string, IRawFunction>()
    /** The regular expression that finds calls (`Compiler.Regex`). */
    readonly regex: RegExp

    constructor(functions: Iterable<IRawFunction>) {
        for (const fn of functions) {
            this.byKey.set(fn.name.toLowerCase(), fn)
            for (const alias of fn.aliases ?? []) {
                if (typeof alias === "string") this.byKey.set(alias.toLowerCase(), fn)
            }
        }
        const names = Array.from(this.byKey.keys())
            .map((x) => (x.startsWith("$") ? x.slice(1) : x).replace(ESCAPE, "\\$1"))
            .sort((a, b) => b.length - a.length)
        // An empty alternation would match `$` alone; with no functions nothing can match.
        this.regex = names.length
            ? new RegExp(`\\$(\\!)?(\\#)?(@\\[(.*?)\\])?(${names.join("|")})`, "gim")
            : /(?!)/g
    }

    /** The function a name runs (case-insensitive, with or without `$`). */
    get(name: string): IRawFunction | undefined {
        const key = name.toLowerCase()
        return this.byKey.get(key.startsWith("$") ? key : `$${key}`)
    }

    /** How many names and aliases call a function. */
    get size() {
        return this.byKey.size
    }

    /** Every function once, whatever names and aliases it has. */
    get functions(): IRawFunction[] {
        return [...new Set(this.byKey.values())]
    }

    /**
     * The functions an installed ForgeScript has registered (`FunctionManager.raw`), after the bot's
     * extensions loaded theirs. When none are registered yet (a script, not a running bot), ForgeScript's
     * own are loaded first, as `FunctionManager.loadNative()` does.
     */
    static fromForgeScript(forgescript: ForgeScriptLike = require("@tryforge/forgescript")) {
        if (!forgescript.FunctionManager.raw.length) forgescript.FunctionManager.loadNative?.()
        return new FunctionTable(withParams(forgescript))
    }

    /**
     * From metadata in the format extensions publish (`metadata/functions.json`: `name`, `aliases`,
     * `brackets`, `args[].condition`, `args[].rest`). Lists are applied in order: as in a bot, an
     * extension loaded first keeps a name a later list (ForgeScript's own) also defines.
     */
    static fromMetadata(...lists: ReadonlyArray<ReadonlyArray<IFunctionMetadata>>) {
        const seen = new Set<string>()
        const out: IRawFunction[] = []
        for (const list of lists) {
            for (const m of list) {
                if (seen.has(m.name)) continue
                seen.add(m.name)
                out.push(fromMetadata(m))
            }
        }
        return new FunctionTable(out)
    }
}

/** A function in an extension's `metadata/functions.json`. */
export interface IFunctionMetadata {
    name: string
    aliases?: readonly string[] | null
    brackets?: boolean | null
    args?: ReadonlyArray<{ name?: string; condition?: boolean; rest?: boolean; required?: boolean; type?: string; enum?: readonly string[] }> | null
    unwrap?: boolean
    deprecated?: boolean
    description?: string
    output?: string | readonly string[] | null
}

/** One metadata entry as the compiler sees it. */
export function fromMetadata(m: IFunctionMetadata): IRawFunction {
    return {
        name: m.name,
        aliases: m.aliases ?? null,
        args:
            m.brackets === undefined || m.brackets === null
                ? null
                : { required: m.brackets, fields: (m.args ?? []).map((a) => ({ condition: !!a.condition, rest: !!a.rest })) },
        params: (m.args ?? []).map((a) => ({ name: a.name ?? "", required: !!a.required, rest: !!a.rest, type: a.type, enum: Array.isArray(a.enum) ? a.enum : undefined })),
        unwrap: !!m.unwrap,
        deprecated: !!m.deprecated,
        description: typeof m.description === "string" ? m.description : undefined,
        output: outputNames(m.output),
    }
}

/** A function's documented output as ArgType names: from metadata (names) or a NativeFunction (ArgType numbers). */
export function outputNames(output: unknown, argType?: Record<number, string>): string[] | undefined {
    const list = Array.isArray(output) ? output : output === undefined || output === null ? [] : [output]
    const names = list.map((t) => (typeof t === "number" ? argType?.[t] : typeof t === "string" ? t : undefined)).filter((t): t is string => !!t)
    return names.length ? names : undefined
}

/** An argument as a NativeFunction defines it: `type` is an ArgType number, `enum` the enum object. */
export interface INativeArg {
    name: string
    required?: boolean
    rest?: boolean
    condition?: boolean
    type?: number | string
    enum?: Record<string, string | number>
}

interface ForgeScriptLike {
    FunctionManager: { raw: IRawFunction[]; loadNative?(): void; get?(name: string): { path?: string; data: { args?: INativeArg[]; unwrap?: boolean; deprecated?: boolean; description?: string; output?: unknown } } | undefined }
    ArgType?: Record<number, string>
}

/** What a function's compiled source does with `$let` variables and the environment store. */
export function storesOf(file: string | undefined): IRawFunction["stores"] {
    if (!file) return undefined
    let text: string
    try {
        text = require("node:fs").readFileSync(file, "utf8")
    } catch {
        return undefined
    }
    return {
        setsVariable: /\.setKeyword\(/.test(text),
        readsVariable: /\.(getKeyword|hasKeyword|deleteKeyword)\(/.test(text),
        setsEnvironment: /\.setEnvironmentKey\(/.test(text),
    }
}

/**
 * The argument positions a NativeFunction's `execute` sends through ForgeScript's argument check, in
 * order: `resolveMultipleArgs(ctx, 0, 2)` and `resolveUnhandledArg(ctx, 1)`, or every one for
 * `resolveArgs(ctx)`. `undefined` when the source cannot be read.
 */
export function resolvedArgsOf(file: string | undefined, count: number): number[] | undefined {
    if (!file) return undefined
    let text: string
    try {
        text = require("node:fs").readFileSync(file, "utf8")
    } catch {
        return undefined
    }
    // Only calls made directly in execute's body: one inside a callback or a loop (a sort's comparison,
    // say) does not stop the command when it fails.
    const start = text.indexOf("{", Math.max(0, text.indexOf("execute(")))
    if (start < 0) return undefined
    let body = ""
    for (let i = start + 1, depth = 1; i < text.length && depth > 0; i++) {
        const c = text[i]
        if (c === '"' || c === "'" || c === "`") {
            const end = text.indexOf(c, i + 1)
            if (depth === 1) body += text.slice(i, end + 1)
            i = end
            continue
        }
        if (c === "{") depth++
        else if (c === "}") depth--
        else if (depth === 1) body += c
    }
    // A function that can finish successfully before its checks ($awaitModalSubmit outside an interaction)
    // checks only sometimes: nothing is counted, rather than a claim that holds only in some events.
    const firstCheck = body.search(/resolve(MultipleArgs|UnhandledArg|Args)"?\]?\(ctx/)
    const earlyReturn = body.search(/\breturn this\.(success|successJSON|stop)\b/)
    if (earlyReturn >= 0 && (firstCheck < 0 || earlyReturn < firstCheck)) return []
    if (/resolveArgs"?\]?\(ctx\)/.test(body)) return Array.from({ length: count }, (_, i) => i)
    const out: number[] = []
    for (const m of body.matchAll(/resolve(MultipleArgs|UnhandledArg)"?\]?\(ctx((?:\s*,\s*\d+)+)\s*[,)]/g)) {
        for (const n of m[2].split(",").filter((x) => x.trim())) {
            const i = Number(n.trim())
            if (Number.isInteger(i) && !out.includes(i)) out.push(i)
        }
    }
    return out
}

/** A NativeFunction's argument, described by name. */
export function paramFromNative(a: INativeArg, argType?: Record<number, string>): IParam {
    const type = typeof a.type === "number" ? argType?.[a.type] : a.type
    const values = a.enum && typeof a.enum === "object" ? Object.keys(a.enum).filter((k) => Number.isNaN(Number(k))) : undefined
    return { name: a.name, required: !!a.required, rest: !!a.rest, type, enum: values, enumObject: a.enum && typeof a.enum === "object" ? a.enum : undefined }
}

/** `FunctionManager.raw`, with each function's documented arguments from its definition. */
export function withParams(forgescript: ForgeScriptLike): IRawFunction[] {
    return forgescript.FunctionManager.raw.map((f) => {
        const native = forgescript.FunctionManager.get?.(f.name)
        const data = native?.data
        if (!data) return { ...f, package: "@tryforge/forgescript" }
        return {
            ...f,
            params: (data.args ?? []).map((a) => paramFromNative(a, forgescript.ArgType)),
            unwrap: !!data.unwrap,
            deprecated: !!data.deprecated,
            package: "@tryforge/forgescript",
            stores: storesOf(native.path),
            resolved: data.unwrap ? undefined : resolvedArgsOf(native.path, data.args?.length ?? 0),
            description: typeof data.description === "string" ? data.description : undefined,
            output: outputNames(data.output, forgescript.ArgType),
        }
    })
}

/** How a function is written with its arguments: `$sendMessage[channel ID;content?;return message ID?]`. */
export function usage(fn: IRawFunction): string {
    if (!fn.args) return fn.name
    const params = fn.params ?? []
    if (!params.length) return `${fn.name}[]`
    return `${fn.name}[${params.map((p) => `${p.name}${p.rest ? "..." : ""}${p.required ? "" : "?"}`).join(";")}]`
}
