"use strict";
// SPDX-License-Identifier: LGPL-3.0-or-later
//
// A bot's ForgeScript, read from its folder: the functions it has (the installed ForgeScript, its
// extensions, its custom functions) and the code in its files, checked together.
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.Project = void 0;
exports.readNatives = readNatives;
exports.customAsRaw = customAsRaw;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const extract_1 = require("./extract");
const rules_1 = require("./rules");
const table_1 = require("./table");
/** Extensions of files that are read. */
const CODE_FILE = /\.(c|m)?(j|t)s$/;
/** Skipped at the top of the project only (`commands/docs` is still read). */
const SKIP_AT_TOP = new Set(["dist", "build", "docs", "coverage", "out"]);
class Project {
    root;
    files;
    properties;
    table;
    sources;
    customFunctions;
    /** What could not be read; shown, never fatal. */
    notes;
    /** Event names a command's `type` can be, `null` when ForgeScript's could not be read. */
    events;
    constructor(root, files, properties, loaded) {
        this.root = root;
        this.files = files;
        this.properties = properties;
        this.events = loaded.events;
        this.table = loaded.table;
        this.sources = loaded.sources;
        this.customFunctions = loaded.custom;
        this.notes = loaded.notes;
    }
    /** Reads a bot's folder: its `package.json`, installed packages and code files. */
    static load(root, options = {}) {
        root = path.resolve(root);
        const properties = options.properties?.length ? options.properties : ["code"];
        const files = (options.include?.length ? options.include : ["."]).flatMap((p) => listFiles(root, path.resolve(root, p)));
        const notes = [];
        const sources = [];
        const raw = [];
        const seen = new Set();
        const extensionEvents = [];
        let events = null;
        const add = (fns, source) => {
            let n = 0;
            for (const f of fns) {
                if (seen.has(f.name))
                    continue;
                seen.add(f.name);
                raw.push(f);
                n++;
            }
            sources.push({ ...source, functions: n });
        };
        // As in a bot: the extensions' functions first, then ForgeScript's own, which skips names already taken.
        for (const dep of dependencies(root)) {
            if (dep === "@tryforge/forgescript")
                continue;
            const dir = packageDir(root, dep);
            if (!dir || !usesForgeScript(dir))
                continue;
            const meta = path.join(dir, "metadata", "functions.json");
            if (!fs.existsSync(meta)) {
                // No metadata (the official extensions on npm): read its NativeFunction files instead.
                const natives = readNatives(dir);
                extensionEvents.push(...natives.events);
                for (const f of natives.failures)
                    notes.push(`${dep}: ${f}`);
                if (natives.functions.length)
                    add(natives.functions, { name: dep, version: version(dir), functions: 0 });
                else
                    notes.push(`${dep} has no metadata/functions.json and no readable NativeFunction files: its functions are unknown`);
                continue;
            }
            const ev = readJson(path.join(dir, "metadata", "events.json"));
            if (Array.isArray(ev))
                extensionEvents.push(...ev.map((e) => (typeof e === "string" ? e : e.name ?? "")));
            try {
                const list = JSON.parse(fs.readFileSync(meta, "utf8"));
                add(list.map(table_1.fromMetadata), { name: dep, version: version(dir), functions: 0 });
            }
            catch (e) {
                notes.push(`${dep}: cannot read metadata/functions.json (${e.message})`);
            }
        }
        const forgeDir = packageDir(root, "@tryforge/forgescript");
        if (forgeDir) {
            try {
                const forgescript = require(forgeDir);
                forgescript.FunctionManager.loadNative();
                add((0, table_1.withParams)(forgescript), { name: "@tryforge/forgescript", version: version(forgeDir), functions: 0 });
                const native = forgeScriptEvents(forgeDir);
                if (native)
                    events = new Set([...native, ...extensionEvents]);
            }
            catch (e) {
                notes.push(`cannot load @tryforge/forgescript (${e.message})`);
            }
        }
        else
            notes.push("@tryforge/forgescript is not installed here: every function name is unknown (run npm install)");
        // Custom functions are added last, and replace a function of the same name, as FunctionManager.add does.
        // Read from the whole bot, even when only some files are checked: they call functions defined elsewhere.
        const everyFile = options.include?.length ? listFiles(root, root) : files;
        const custom = everyFile.flatMap((f) => customFunctions(root, f, properties));
        for (const c of custom) {
            const fn = customAsRaw(c);
            const i = raw.findIndex((x) => x.name.toLowerCase() === fn.name.toLowerCase());
            if (i >= 0)
                raw[i] = fn;
            else
                raw.push(fn);
        }
        if (custom.length)
            sources.push({ name: "custom", version: null, functions: custom.length });
        return new Project(root, files, properties, { table: new table_1.FunctionTable(raw), sources, custom, notes, events });
    }
    /** Checks every file. */
    check() {
        return this.files.flatMap((f) => this.checkFile(f));
    }
    /** Checks one file (absolute, or relative to the root). */
    checkFile(file) {
        const abs = path.resolve(this.root, file);
        const text = fs.readFileSync(abs, "utf8");
        const rel = path.relative(this.root, abs).split(path.sep).join("/");
        const out = [];
        const objects = objectLiterals(text);
        for (const src of (0, extract_1.extractCode)(text, this.properties))
            out.push(...this.checkSource(text, rel, src, objects));
        return out.sort((a, b) => a.line - b.line || a.column - b.column);
    }
    checkSource(text, file, src, objects) {
        const out = [];
        const at = (start, end, severity, rule, message) => {
            const a = (0, extract_1.lineColumn)(text, (0, extract_1.fileOffset)(src, start));
            const b = (0, extract_1.lineColumn)(text, end > start ? (0, extract_1.fileOffset)(src, end - 1) + 1 : (0, extract_1.fileOffset)(src, start));
            out.push({ file, line: a.line, column: a.column, endLine: b.line, endColumn: b.column, severity, rule, message });
        };
        if (src.error) {
            const a = (0, extract_1.lineColumn)(text, src.start);
            out.push({ file, line: a.line, column: a.column, endLine: a.line, endColumn: a.column + 1, severity: "warning", rule: "unreadable-string", message: `This ${src.property}: string cannot be read to its end (${src.error}), so it was not checked` });
            return out;
        }
        for (const f of (0, rules_1.checkCode)(src.value, this.table)) {
            // A name right before a ${...} may be completed when the bot runs.
            if ((f.rule === "unknown-function" || f.rule === "glued-name") && src.value[f.end] === extract_1.DYNAMIC)
                continue;
            at(f.start, f.end, f.severity, f.rule, f.message);
        }
        // The command's type, in the same object as its code. Application commands (with `data`) are skipped.
        const obj = objects.filter((o) => o.start < src.start && src.end <= o.end).pop();
        const type = obj?.props.get("type");
        if (this.events && obj && type && !obj.props.has("data") && !type.dynamic && !type.error && !this.events.has(type.value)) {
            const a = (0, extract_1.lineColumn)(text, type.start);
            const b = (0, extract_1.lineColumn)(text, type.end);
            const guess = closest(type.value, this.events);
            out.push({ file, line: a.line, column: a.column, endLine: b.line, endColumn: b.column, severity: "error", rule: "unknown-event", message: `"${type.value}" is not an event of ForgeScript or its extensions here, so this command never runs${guess ? `. Did you mean "${guess}"?` : ""}` });
        }
        return out;
    }
}
exports.Project = Project;
/** Every object literal in a file, with its own properties, skipping strings and comments. */
function objectLiterals(text) {
    const out = [];
    const stack = [];
    const key = /([A-Za-z_$][\w$]*|"[^"\n]*"|'[^'\n]*')\s*:/y;
    let expectKey = false;
    for (let i = 0; i < text.length;) {
        const c = text[i];
        if (c === "/" && (text[i + 1] === "/" || text[i + 1] === "*")) {
            i = text[i + 1] === "/" ? (text.indexOf("\n", i) + 1 || text.length) : (text.indexOf("*/", i + 2) + 2 || text.length);
            continue;
        }
        if (/\s/.test(c)) {
            i++;
            continue;
        }
        if (expectKey && stack.length) {
            key.lastIndex = i;
            const m = key.exec(text);
            expectKey = false;
            if (m) {
                const name = m[1].replace(/^["']|["']$/g, "");
                let j = key.lastIndex;
                while (/\s/.test(text[j] ?? ""))
                    j++;
                const q = text[j];
                if (q === '"' || q === "'" || q === "`") {
                    const r = (0, extract_1.cook)(text, j);
                    stack[stack.length - 1].props.set(name, { property: name, value: r.value, offsets: r.offsets, start: j, end: r.end, dynamic: r.dynamic, error: r.error });
                    i = r.end;
                }
                else {
                    stack[stack.length - 1].props.set(name, { property: name, value: "", offsets: [], start: j, end: j, dynamic: true, error: "not a string" });
                    i = j;
                }
                continue;
            }
        }
        if (c === '"' || c === "'" || c === "`") {
            i = (0, extract_1.cook)(text, i).end;
            continue;
        }
        if (c === "{") {
            const o = { start: i, end: text.length, props: new Map() };
            stack.push(o);
            out.push(o);
            expectKey = true;
        }
        else if (c === "}") {
            const o = stack.pop();
            if (o)
                o.end = i + 1;
        }
        else if (c === "," && stack.length)
            expectKey = true;
        else if (c === "(" || c === "[")
            stack.push({ start: -1, end: -1, props: new Map() });
        else if ((c === ")" || c === "]") && stack.length && stack[stack.length - 1].start === -1)
            stack.pop();
        i++;
    }
    return out;
}
/**
 * The functions and event names an extension defines in code: its `NativeFunction` files and event
 * handlers, loaded without starting the extension. Only files that mention them are loaded.
 */
function readNatives(dir) {
    const functions = [];
    const events = [];
    const failures = [];
    const seen = new Set();
    const visit = (d) => {
        let entries = [];
        try {
            entries = fs.readdirSync(d, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const e of entries) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) {
                if (e.name !== "node_modules" && !e.name.startsWith("."))
                    visit(p);
                continue;
            }
            if (!/\.c?js$/.test(e.name))
                continue;
            const text = fs.readFileSync(p, "utf8");
            const native = text.includes("NativeFunction");
            const handler = text.includes("EventHandler");
            if (!native && !handler)
                continue;
            let item;
            try {
                const exported = require(p);
                item = exported?.default ?? exported;
            }
            catch (err) {
                failures.push(`cannot load ${path.relative(dir, p)} (${err.message})`);
                continue;
            }
            const data = item?.data;
            if (native && data && typeof data.name === "string" && data.name.startsWith("$")) {
                if (seen.has(data.name))
                    continue;
                seen.add(data.name);
                const args = data.args ?? [];
                functions.push({
                    name: data.name,
                    aliases: data.aliases ?? null,
                    args: data.brackets === undefined ? null : { required: data.brackets, fields: args.map((a) => ({ condition: !!a.condition, rest: !!a.rest })) },
                    params: args.map((a) => ({ name: a.name, required: !!a.required, rest: !!a.rest })),
                    unwrap: !!data.unwrap && args.length > 0,
                    deprecated: !!data.deprecated,
                });
            }
            else if (handler && item && typeof item.name === "string" && typeof item.register === "function")
                events.push(item.name);
        }
    };
    visit(fs.existsSync(path.join(dir, "dist")) ? path.join(dir, "dist") : dir);
    return { functions, events, failures };
}
/** The events ForgeScript has: the handler files in its `handlers/events` folder. */
function forgeScriptEvents(forgeDir) {
    const dir = path.join(forgeDir, "dist", "handlers", "events");
    if (!fs.existsSync(dir))
        return null;
    const out = [];
    for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith(".js"))
            continue;
        try {
            const name = require(path.join(dir, f)).default?.name;
            if (typeof name === "string")
                out.push(name);
        }
        catch {
            // A handler that cannot be loaded is left out.
        }
    }
    return out;
}
function closest(word, names) {
    let best = null;
    let bestD = Infinity;
    for (const n of names) {
        const d = editDistance(word.toLowerCase(), n.toLowerCase());
        if (d < bestD)
            (bestD = d), (best = n);
    }
    return bestD <= Math.max(1, Math.floor(word.length / 4)) ? best : null;
}
function editDistance(a, b) {
    const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
        let prev = dp[0];
        dp[0] = i;
        for (let j = 1; j <= b.length; j++) {
            const tmp = dp[j];
            dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
            prev = tmp;
        }
    }
    return dp[b.length];
}
function listFiles(root, start) {
    if (!fs.existsSync(start))
        return [];
    if (fs.statSync(start).isFile())
        return CODE_FILE.test(start) && !start.endsWith(".d.ts") ? [start] : [];
    const out = [];
    const visit = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
            if (e.name === "node_modules" || e.name.startsWith("."))
                continue;
            const p = path.join(dir, e.name);
            if (e.isDirectory()) {
                if (dir === root && SKIP_AT_TOP.has(e.name))
                    continue;
                visit(p);
            }
            else if (e.isFile() && CODE_FILE.test(e.name) && !e.name.endsWith(".d.ts"))
                out.push(p);
        }
    };
    visit(start);
    return out;
}
function dependencies(root) {
    try {
        const pj = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
        return Object.keys({ ...pj.dependencies, ...pj.devDependencies, ...pj.optionalDependencies });
    }
    catch {
        return [];
    }
}
function packageDir(root, name) {
    for (let d = root;; d = path.dirname(d)) {
        const p = path.join(d, "node_modules", name);
        if (fs.existsSync(path.join(p, "package.json")))
            return p;
        if (path.dirname(d) === d)
            return null;
    }
}
function readJson(file) {
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    }
    catch {
        return null;
    }
}
function version(dir) {
    return readJson(path.join(dir, "package.json"))?.version ?? null;
}
function usesForgeScript(dir) {
    const pj = readJson(path.join(dir, "package.json"));
    return !!pj && ["dependencies", "peerDependencies", "devDependencies"].some((k) => pj[k] && "@tryforge/forgescript" in pj[k]);
}
/**
 * Custom functions written as `{ name: "...", params: [...], code: "..." }` in the bot's files.
 * Read from the text, not run: names, params, `brackets` and `firstParamCondition` must be literals.
 */
function customFunctions(root, file, properties) {
    const text = fs.readFileSync(file, "utf8");
    // In a `functions` folder every { name, code } is a custom function; elsewhere only those with params.
    const inFunctionsFolder = path.relative(root, file).split(path.sep).slice(0, -1).includes("functions");
    if (!inFunctionsFolder && !/\bparams\s*:/.test(text))
        return [];
    const names = (0, extract_1.extractCode)(text, ["name", ...properties]).filter((s) => s.property === "name" && !s.dynamic && !s.error);
    const out = [];
    names.forEach((s, k) => {
        const seg = text.slice(s.end, k + 1 < names.length ? names[k + 1].start : text.length);
        const pm = /\bparams\s*:\s*\[/.exec(seg);
        if (!pm && !inFunctionsFolder)
            return;
        const params = [];
        let body = "";
        if (pm) {
            let j = pm.index + pm[0].length - 1;
            for (let depth = 0; j < seg.length; j++) {
                if (seg[j] === "[")
                    depth++;
                else if (seg[j] === "]" && --depth === 0)
                    break;
            }
            body = seg.slice(pm.index + pm[0].length, j);
        }
        for (const m of body.matchAll(/\{[^{}]*\}|(["'`])(\w+)\1/g)) {
            if (m[0].startsWith("{")) {
                const nm = /name\s*:\s*["'`](\w+)/.exec(m[0]);
                if (nm)
                    params.push({ name: nm[1], rest: /rest\s*:\s*true/.test(m[0]), required: !/required\s*:\s*false/.test(m[0]) });
            }
            else
                params.push(m[2]);
        }
        const b = /\bbrackets\s*:\s*(true|false)/.exec(seg);
        out.push({
            name: s.value.replace(/^\$/, ""),
            params,
            brackets: b ? b[1] === "true" : undefined,
            firstParamCondition: /\bfirstParamCondition\s*:\s*true/.test(seg),
            file: path.relative(root, file).split(path.sep).join("/"),
        });
    });
    return out;
}
/** A custom function as the compiler sees it (`ForgeFunction.asNative`, then `FunctionManager.raw`). */
function customAsRaw(c) {
    const brackets = c.brackets ?? (c.params.length ? true : undefined);
    return {
        name: `$${c.name}`,
        aliases: null,
        args: brackets === undefined
            ? null
            : {
                required: brackets,
                fields: c.params.map((p, i) => ({ rest: typeof p === "string" ? false : !!p.rest, condition: i === 0 && c.firstParamCondition })),
            },
        params: c.params.map((p) => (typeof p === "string" ? { name: p, required: true, rest: false } : { name: p.name, required: p.required ?? true, rest: !!p.rest })),
        unwrap: c.params.length > 0 && !c.firstParamCondition,
    };
}
//# sourceMappingURL=project.js.map