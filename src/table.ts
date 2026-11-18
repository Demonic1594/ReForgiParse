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

/** A function as ForgeScript's compiler sees it (the shape of `FunctionManager.raw`). */
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
    static fromForgeScript(forgescript: { FunctionManager: { raw: IRawFunction[] } } = require("@tryforge/forgescript")) {
        return new FunctionTable(forgescript.FunctionManager.raw)
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
    args?: ReadonlyArray<{ condition?: boolean; rest?: boolean }> | null
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
    }
}
