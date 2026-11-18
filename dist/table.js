"use strict";
// SPDX-License-Identifier: LGPL-3.0-or-later
//
// The function table: what ForgeScript's compiler knows about each function, and the regular
// expression it finds calls with. Mirrors Compiler.setFunctions() and FunctionManager.raw in
// ForgeScript (github.com/tryforge/ForgeScript, LGPL-3.0-or-later).
Object.defineProperty(exports, "__esModule", { value: true });
exports.FunctionTable = void 0;
exports.fromMetadata = fromMetadata;
exports.storesOf = storesOf;
exports.paramFromNative = paramFromNative;
exports.withParams = withParams;
exports.usage = usage;
/** Escapes a name the way ForgeScript does before joining names into one regular expression. */
const ESCAPE = /(\.|\$|\(|\)|\*|\[|\]|\{|\}|\?|!|\^)/gim;
/**
 * The functions a bot has, in the order ForgeScript registers them. A later name or alias replaces
 * the earlier function but keeps its place, as `Collection.set` does.
 */
class FunctionTable {
    /** Lower-case name or alias, with `$`, to the function. */
    byKey = new Map();
    /** The regular expression that finds calls (`Compiler.Regex`). */
    regex;
    constructor(functions) {
        for (const fn of functions) {
            this.byKey.set(fn.name.toLowerCase(), fn);
            for (const alias of fn.aliases ?? []) {
                if (typeof alias === "string")
                    this.byKey.set(alias.toLowerCase(), fn);
            }
        }
        const names = Array.from(this.byKey.keys())
            .map((x) => (x.startsWith("$") ? x.slice(1) : x).replace(ESCAPE, "\\$1"))
            .sort((a, b) => b.length - a.length);
        // An empty alternation would match `$` alone; with no functions nothing can match.
        this.regex = names.length
            ? new RegExp(`\\$(\\!)?(\\#)?(@\\[(.*?)\\])?(${names.join("|")})`, "gim")
            : /(?!)/g;
    }
    /** The function a name runs (case-insensitive, with or without `$`). */
    get(name) {
        const key = name.toLowerCase();
        return this.byKey.get(key.startsWith("$") ? key : `$${key}`);
    }
    get size() {
        return this.byKey.size;
    }
    /**
     * The functions an installed ForgeScript has registered (`FunctionManager.raw`), after the bot's
     * extensions loaded theirs. Without a running bot, call `FunctionManager.loadNative()` first.
     */
    static fromForgeScript(forgescript = require("@tryforge/forgescript")) {
        return new FunctionTable(withParams(forgescript));
    }
    /**
     * From metadata in the format extensions publish (`metadata/functions.json`: `name`, `aliases`,
     * `brackets`, `args[].condition`, `args[].rest`). Lists are applied in order: as in a bot, an
     * extension loaded first keeps a name a later list (ForgeScript's own) also defines.
     */
    static fromMetadata(...lists) {
        const seen = new Set();
        const out = [];
        for (const list of lists) {
            for (const m of list) {
                if (seen.has(m.name))
                    continue;
                seen.add(m.name);
                out.push(fromMetadata(m));
            }
        }
        return new FunctionTable(out);
    }
}
exports.FunctionTable = FunctionTable;
/** One metadata entry as the compiler sees it. */
function fromMetadata(m) {
    return {
        name: m.name,
        aliases: m.aliases ?? null,
        args: m.brackets === undefined || m.brackets === null
            ? null
            : { required: m.brackets, fields: (m.args ?? []).map((a) => ({ condition: !!a.condition, rest: !!a.rest })) },
        params: (m.args ?? []).map((a) => ({ name: a.name ?? "", required: !!a.required, rest: !!a.rest, type: a.type, enum: Array.isArray(a.enum) ? a.enum : undefined })),
        unwrap: !!m.unwrap,
        deprecated: !!m.deprecated,
    };
}
/** What a function's compiled source does with `$let` variables and the environment store. */
function storesOf(file) {
    if (!file)
        return undefined;
    let text;
    try {
        text = require("node:fs").readFileSync(file, "utf8");
    }
    catch {
        return undefined;
    }
    return {
        setsVariable: /\.setKeyword\(/.test(text),
        readsVariable: /\.(getKeyword|hasKeyword|deleteKeyword)\(/.test(text),
        setsEnvironment: /\.setEnvironmentKey\(/.test(text),
    };
}
/** A NativeFunction's argument, described by name. */
function paramFromNative(a, argType) {
    const type = typeof a.type === "number" ? argType?.[a.type] : a.type;
    const values = a.enum && typeof a.enum === "object" ? Object.keys(a.enum).filter((k) => Number.isNaN(Number(k))) : undefined;
    return { name: a.name, required: !!a.required, rest: !!a.rest, type, enum: values };
}
/** `FunctionManager.raw`, with each function's documented arguments from its definition. */
function withParams(forgescript) {
    return forgescript.FunctionManager.raw.map((f) => {
        const native = forgescript.FunctionManager.get?.(f.name);
        const data = native?.data;
        if (!data)
            return { ...f, package: "@tryforge/forgescript" };
        return {
            ...f,
            params: (data.args ?? []).map((a) => paramFromNative(a, forgescript.ArgType)),
            unwrap: !!data.unwrap,
            deprecated: !!data.deprecated,
            package: "@tryforge/forgescript",
            stores: storesOf(native.path),
        };
    });
}
/** How a function is written with its arguments: `$sendMessage[channel ID;content?;return message ID?]`. */
function usage(fn) {
    if (!fn.args)
        return fn.name;
    const params = fn.params ?? [];
    if (!params.length)
        return `${fn.name}[]`;
    return `${fn.name}[${params.map((p) => `${p.name}${p.rest ? "..." : ""}${p.required ? "" : "?"}`).join(";")}]`;
}
//# sourceMappingURL=table.js.map