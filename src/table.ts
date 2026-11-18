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

    get size() {
        return this.byKey.size
    }

    /**
     * The functions an installed ForgeScript has registered (`FunctionManager.raw`), after the bot's
     * extensions loaded theirs. Without a running bot, call `FunctionManager.loadNative()` first.
     */
    static fromForgeScript(forgescript: ForgeScriptLike = require("@tryforge/forgescript")) {
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
    args?: ReadonlyArray<{ name?: string; condition?: boolean; rest?: boolean; required?: boolean }> | null
    unwrap?: boolean
    deprecated?: boolean
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
        params: (m.args ?? []).map((a) => ({ name: a.name ?? "", required: !!a.required, rest: !!a.rest })),
        unwrap: !!m.unwrap,
        deprecated: !!m.deprecated,
    }
}

interface ForgeScriptLike {
    FunctionManager: { raw: IRawFunction[]; get?(name: string): { data: { args?: IParam[]; unwrap?: boolean; deprecated?: boolean } } | undefined }
}

/** `FunctionManager.raw`, with each function's documented arguments from its definition. */
export function withParams(forgescript: ForgeScriptLike): IRawFunction[] {
    return forgescript.FunctionManager.raw.map((f) => {
        const data = forgescript.FunctionManager.get?.(f.name)?.data
        return data ? { ...f, params: (data.args ?? []).map((a) => ({ name: a.name, required: !!a.required, rest: !!a.rest })), unwrap: !!data.unwrap, deprecated: !!data.deprecated } : f
    })
}

/** How a function is written with its arguments: `$sendMessage[channel ID;content?;return message ID?]`. */
export function usage(fn: IRawFunction): string {
    if (!fn.args) return fn.name
    const params = fn.params ?? []
    if (!params.length) return `${fn.name}[]`
    return `${fn.name}[${params.map((p) => `${p.name}${p.rest ? "..." : ""}${p.required ? "" : "?"}`).join(";")}]`
}
