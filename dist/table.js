"use strict";
// SPDX-License-Identifier: LGPL-3.0-or-later
//
// The function table: what ForgeScript's compiler knows about each function, and the regular
// expression it finds calls with. Mirrors Compiler.setFunctions() and FunctionManager.raw in
// ForgeScript (github.com/tryforge/ForgeScript, LGPL-3.0-or-later).
Object.defineProperty(exports, "__esModule", { value: true });
exports.FunctionTable = void 0;
exports.fromMetadata = fromMetadata;
exports.outputNames = outputNames;
exports.storesOf = storesOf;
exports.resolvedArgsOf = resolvedArgsOf;
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
    /** How many names and aliases call a function. */
    get size() {
        return this.byKey.size;
    }
    /** Every function once, whatever names and aliases it has. */
    get functions() {
        return [...new Set(this.byKey.values())];
    }
    /**
     * The functions an installed ForgeScript has registered (`FunctionManager.raw`), after the bot's
     * extensions loaded theirs. When none are registered yet (a script, not a running bot), ForgeScript's
     * own are loaded first, as `FunctionManager.loadNative()` does.
     */
    static fromForgeScript(forgescript = require("@tryforge/forgescript")) {
        if (!forgescript.FunctionManager.raw.length)
            forgescript.FunctionManager.loadNative?.();
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
        description: typeof m.description === "string" ? m.description : undefined,
        output: outputNames(m.output),
    };
}
/** A function's documented output as ArgType names: from metadata (names) or a NativeFunction (ArgType numbers). */
function outputNames(output, argType) {
    const list = Array.isArray(output) ? output : output === undefined || output === null ? [] : [output];
    const names = list.map((t) => (typeof t === "number" ? argType?.[t] : typeof t === "string" ? t : undefined)).filter((t) => !!t);
    return names.length ? names : undefined;
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
/**
 * The argument positions a NativeFunction's `execute` sends through ForgeScript's argument check, in
 * order: `resolveMultipleArgs(ctx, 0, 2)` and `resolveUnhandledArg(ctx, 1)`, or every one for
 * `resolveArgs(ctx)`. `undefined` when the source cannot be read.
 */
function resolvedArgsOf(file, count) {
    if (!file)
        return undefined;
    let text;
    try {
        text = require("node:fs").readFileSync(file, "utf8");
    }
    catch {
        return undefined;
    }
    // Only calls made directly in execute's body: one inside a callback or a loop (a sort's comparison,
    // say) does not stop the command when it fails.
    const start = text.indexOf("{", Math.max(0, text.indexOf("execute(")));
    if (start < 0)
        return undefined;
    let body = "";
    for (let i = start + 1, depth = 1; i < text.length && depth > 0; i++) {
        const c = text[i];
        if (c === '"' || c === "'" || c === "`") {
            const end = text.indexOf(c, i + 1);
            if (depth === 1)
                body += text.slice(i, end + 1);
            i = end;
            continue;
        }
        if (c === "{")
            depth++;
        else if (c === "}")
            depth--;
        else if (depth === 1)
            body += c;
    }
    // A function that can finish successfully before its checks ($awaitModalSubmit outside an interaction)
    // checks only sometimes: nothing is counted, rather than a claim that holds only in some events.
    const firstCheck = body.search(/resolve(MultipleArgs|UnhandledArg|Args)"?\]?\(ctx/);
    const earlyReturn = body.search(/\breturn this\.(success|successJSON|stop)\b/);
    if (earlyReturn >= 0 && (firstCheck < 0 || earlyReturn < firstCheck))
        return [];
    if (/resolveArgs"?\]?\(ctx\)/.test(body))
        return Array.from({ length: count }, (_, i) => i);
    const out = [];
    for (const m of body.matchAll(/resolve(MultipleArgs|UnhandledArg)"?\]?\(ctx((?:\s*,\s*\d+)+)\s*[,)]/g)) {
        for (const n of m[2].split(",").filter((x) => x.trim())) {
            const i = Number(n.trim());
            if (Number.isInteger(i) && !out.includes(i))
                out.push(i);
        }
    }
    return out;
}
/** A NativeFunction's argument, described by name. */
function paramFromNative(a, argType) {
    const type = typeof a.type === "number" ? argType?.[a.type] : a.type;
    const values = a.enum && typeof a.enum === "object" ? Object.keys(a.enum).filter((k) => Number.isNaN(Number(k))) : undefined;
    return { name: a.name, required: !!a.required, rest: !!a.rest, type, enum: values, enumObject: a.enum && typeof a.enum === "object" ? a.enum : undefined };
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
            resolved: data.unwrap ? undefined : resolvedArgsOf(native.path, data.args?.length ?? 0),
            description: typeof data.description === "string" ? data.description : undefined,
            output: outputNames(data.output, forgescript.ArgType),
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