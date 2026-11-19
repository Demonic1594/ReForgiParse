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
exports.Project = exports.ProjectRules = void 0;
exports.readNatives = readNatives;
exports.customAsRaw = customAsRaw;
var core_1 = require("./core");
Object.defineProperty(exports, "ProjectRules", { enumerable: true, get: function () { return core_1.ProjectRules; } });
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const config_1 = require("./config");
const core_2 = require("./core");
const extract_1 = require("./extract");
const values_1 = require("./values");
const table_1 = require("./table");
/** This package's name, as a bot lists it among its dependencies. */
const SELF = require("../package.json").name;
/** Extensions of files that are read. */
const CODE_FILE = /\.(c|m)?(j|t)s$/;
/** Skipped at the top of the project only (`commands/docs` is still read). */
const SKIP_AT_TOP = new Set(["dist", "build", "docs", "coverage", "out"]);
class Project {
    root;
    files;
    properties;
    config;
    table;
    sources;
    customFunctions;
    /** What could not be read; shown, never fatal. */
    notes;
    /** Checks literal argument values with the bot's ForgeScript. */
    values;
    /** Event names a command's `type` can be, `null` when ForgeScript's could not be read. */
    events;
    constructor(root, files, properties, config, loaded) {
        this.root = root;
        this.files = files;
        this.properties = properties;
        this.config = config;
        this.values = loaded.values;
        this.events = loaded.events;
        this.table = loaded.table;
        this.sources = loaded.sources;
        this.customFunctions = loaded.custom;
        this.notes = loaded.notes;
    }
    /** Reads a bot's folder: its `package.json`, installed packages and code files. */
    static load(root, options = {}) {
        root = path.resolve(root);
        const config = options.config ?? (0, config_1.loadConfig)(root).config;
        // A config passed in code is checked too (one read from a file already was, with its path).
        if (options.config)
            (0, config_1.checkRuleNames)(options.config.rules, "the config passed to Project.load");
        const properties = options.properties?.length ? options.properties : config.properties?.length ? config.properties : ["code"];
        const exclude = config.exclude ?? [];
        const include = options.include?.length ? options.include : config.include?.length ? config.include : ["."];
        const files = include.flatMap((p) => listFiles(root, path.resolve(root, p), exclude));
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
        const forgeDir = packageDir(root, "@tryforge/forgescript");
        let forgescript = null;
        if (forgeDir) {
            try {
                forgescript = require(forgeDir);
            }
            catch (e) {
                notes.push(`cannot load @tryforge/forgescript (${e.message})`);
            }
        }
        else
            notes.push("@tryforge/forgescript is not installed here: every function name is unknown (run npm install)");
        const tag = (fns, pkg) => fns.map((f) => ({ ...f, package: f.package ?? pkg }));
        // As in a bot: the extensions' functions first, then ForgeScript's own, which skips names already taken.
        for (const dep of dependencies(root)) {
            // ReForgiParse depends on ForgeScript too, but is no extension: it has no functions to add.
            if (dep === "@tryforge/forgescript" || dep === SELF)
                continue;
            const dir = packageDir(root, dep);
            if (!dir || !usesForgeScript(dir))
                continue;
            const meta = path.join(dir, "metadata", "functions.json");
            if (!fs.existsSync(meta)) {
                // No metadata (the official extensions on npm): read its NativeFunction files instead.
                const natives = readNatives(dir, forgescript?.ArgType);
                extensionEvents.push(...natives.events);
                for (const f of natives.failures)
                    notes.push(`${dep}: ${f}`);
                if (natives.functions.length)
                    add(tag(natives.functions, dep), { name: dep, version: version(dir), functions: 0 });
                else
                    notes.push(`${dep} has no metadata/functions.json and no readable NativeFunction files: its functions are unknown`);
                continue;
            }
            const ev = readJson(path.join(dir, "metadata", "events.json"));
            if (Array.isArray(ev))
                extensionEvents.push(...ev.map((e) => (typeof e === "string" ? e : e.name ?? "")));
            try {
                const list = JSON.parse(fs.readFileSync(meta, "utf8"));
                add(tag(list.map(table_1.fromMetadata), dep), { name: dep, version: version(dir), functions: 0 });
            }
            catch (e) {
                notes.push(`${dep}: cannot read metadata/functions.json (${e.message})`);
            }
        }
        if (forgescript) {
            try {
                // Once per process: loading them again (the language server reads the bot on every save) makes ForgeScript warn.
                if (!forgescript.FunctionManager.get?.("$ping"))
                    forgescript.FunctionManager.loadNative();
                add((0, table_1.withParams)(forgescript), { name: "@tryforge/forgescript", version: version(forgeDir), functions: 0 });
                const native = forgeScriptEvents(forgeDir);
                if (native)
                    events = new Set([...native, ...extensionEvents]);
            }
            catch (e) {
                notes.push(`cannot read ForgeScript's functions (${e.message})`);
            }
        }
        // Custom functions are added last, and replace a function of the same name, as FunctionManager.add does.
        // Read from the whole bot, even when only some files are checked: they call functions defined elsewhere.
        const everyFile = include.length === 1 && include[0] === "." ? files : listFiles(root, root, exclude);
        const custom = everyFile.flatMap((f) => customFunctions(root, f, properties));
        for (const c of custom) {
            const fn = { ...customAsRaw(c), description: `A custom function, in ${c.file}` };
            const i = raw.findIndex((x) => x.name.toLowerCase() === fn.name.toLowerCase());
            if (i >= 0)
                raw[i] = fn;
            else
                raw.push(fn);
        }
        if (custom.length)
            sources.push({ name: "custom", version: null, functions: custom.length });
        // Names the config says exist (made when the bot runs): any arguments, and unknown use of variables.
        for (const k of config.known ?? []) {
            const name = k.startsWith("$") ? k : `$${k}`;
            if (!raw.some((x) => x.name.toLowerCase() === name.toLowerCase()))
                raw.push({ name, aliases: null, args: { required: false, fields: [{ rest: true }] }, package: "known" });
        }
        if (config.known?.length)
            sources.push({ name: "known (config)", version: null, functions: config.known.length });
        let discord = null;
        try {
            discord = forgeDir ? require(require.resolve("discord.js", { paths: [forgeDir] })) : null;
        }
        catch {
            // Colour names are then not known: only hex and numbers are taken as colours.
        }
        const values = new values_1.ValueChecker(forgescript, discord);
        return new Project(root, files, properties, config, { table: new table_1.FunctionTable(raw), sources, custom, notes, events, values });
    }
    /** Checks every file. */
    check() {
        return this.files.flatMap((f) => this.checkFile(f));
    }
    /** Checks one file (absolute, or relative to the root). */
    checkFile(file) {
        const abs = path.resolve(this.root, file);
        const rel = path.relative(this.root, abs).split(path.sep).join("/");
        return (0, core_2.checkScript)(fs.readFileSync(abs, "utf8"), this.table, { file: rel, properties: this.properties, values: this.values, events: this.events, rules: this.config.rules });
    }
}
exports.Project = Project;
/**
 * The functions and event names an extension defines in code: its `NativeFunction` files and event
 * handlers, loaded without starting the extension. Only files that mention them are loaded.
 */
function readNatives(dir, argType) {
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
                    params: args.map((a) => (0, table_1.paramFromNative)(a, argType)),
                    unwrap: !!data.unwrap && args.length > 0,
                    deprecated: !!data.deprecated,
                    stores: (0, table_1.storesOf)(p),
                    resolved: data.unwrap ? undefined : (0, table_1.resolvedArgsOf)(p, args.length),
                    description: typeof data.description === "string" ? data.description : undefined,
                    output: (0, table_1.outputNames)(data.output, argType),
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
function listFiles(root, start, exclude = []) {
    if (!fs.existsSync(start))
        return [];
    const rel = (p) => path.relative(root, p).split(path.sep).join("/");
    const clean = (x) => x.replace(/^\.\//, "").replace(/\/$/, "");
    const excluded = (p, name) => exclude.some((x) => x === name || clean(x) === rel(p));
    if (fs.statSync(start).isFile())
        return CODE_FILE.test(start) && !start.endsWith(".d.ts") && !excluded(start, path.basename(start)) ? [start] : [];
    const out = [];
    const visit = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
            if (e.name === "node_modules" || e.name.startsWith("."))
                continue;
            const p = path.join(dir, e.name);
            if (excluded(p, e.name))
                continue;
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
        package: "custom",
    };
}
//# sourceMappingURL=project.js.map