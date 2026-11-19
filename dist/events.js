"use strict";
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
exports.packageSources = packageSources;
exports.splitTopLevel = splitTopLevel;
exports.eventSites = eventSites;
exports.readsEventData = readsEventData;
exports.probeExtension = probeExtension;
exports.probeExtensions = probeExtensions;
// SPDX-License-Identifier: LGPL-3.0-or-later
/**
 * What an extension's events give a command, and which of its functions read it.
 *
 * Read from the extension's source: for each event, the data its handler passes when it runs a command
 * (`extras`, and `states` for an extension's own Context), followed through a helper (`runEvent(this,
 * "giveawayEnd", gw, { giveaway: { new: gw } })`) and back to where the event is emitted
 * (`emit("variableCreate", { data, event: "variableCreate" })`). Only object literals are followed:
 * data built anywhere else is unknown, and then nothing is checked for that event.
 *
 * Which functions read it is not guessed from their text: each function whose source reads
 * `ctx.runtime.extras` or `ctx.extendedStates` (itself or through a helper in its package) is run, in a
 * child process, on stand-in data shaped like each event's ({@link probeExtension}). A function counts
 * as reading its events' data when it gives something with one of its own events' data and nothing
 * (or a TypeError) with none, as in another package's event.
 */
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const node_child_process_1 = require("node:child_process");
/** The JavaScript files of a package (its `dist`, else all of it), without node_modules. */
function packageSources(dir) {
    const out = [];
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
            }
            else if (/\.c?js$/.test(e.name)) {
                try {
                    out.push({ file: p, text: fs.readFileSync(p, "utf8") });
                }
                catch {
                    // An unreadable file is left out.
                }
            }
        }
    };
    visit(fs.existsSync(path.join(dir, "dist")) ? path.join(dir, "dist") : dir);
    return out;
}
/** Skips a string, template or comment starting at `i`, or returns `i` when there is none. */
function skip(text, i) {
    const c = text[i];
    if (c === '"' || c === "'" || c === "`") {
        for (let j = i + 1; j < text.length; j++) {
            if (text[j] === "\\")
                j++;
            else if (text[j] === c)
                return j + 1;
        }
        return text.length;
    }
    if (c === "/" && text[i + 1] === "/") {
        const end = text.indexOf("\n", i);
        return end < 0 ? text.length : end;
    }
    if (c === "/" && text[i + 1] === "*") {
        const end = text.indexOf("*/", i + 2);
        return end < 0 ? text.length : end + 2;
    }
    return i;
}
/** The text from an opening bracket at `open` to its match (exclusive), split at top-level commas. */
function splitTopLevel(text, open) {
    const parts = [];
    let depth = 0;
    let start = open + 1;
    for (let i = open; i < text.length;) {
        const s = skip(text, i);
        if (s !== i) {
            i = s;
            continue;
        }
        const c = text[i];
        if (c === "(" || c === "[" || c === "{")
            depth++;
        else if (c === ")" || c === "]" || c === "}") {
            depth--;
            if (depth === 0) {
                const last = text.slice(start, i).trim();
                if (last)
                    parts.push(last);
                return { parts, end: i };
            }
        }
        else if (c === "," && depth === 1) {
            parts.push(text.slice(start, i).trim());
            start = i + 1;
        }
        i++;
    }
    return null;
}
/** The entries of an object literal: `key: value`, or a shorthand `key`. `null` for a spread or a computed key. */
function entries(literal) {
    const split = splitTopLevel(literal, 0);
    if (!split)
        return null;
    const out = new Map();
    for (const part of split.parts) {
        const m = /^(?:(["'])([^"']*)\1|([A-Za-z_$][\w$]*))\s*(?::\s*([\s\S]*))?$/.exec(part);
        if (!m)
            return null;
        const key = m[2] ?? m[3];
        out.set(key, m[4] ?? key);
    }
    return out;
}
/**
 * The shape of an expression. An identifier is looked up in the scope (a helper's parameter, or the
 * listener's, through `listener`). Anything that is not a literal, nor leads to one, is `null` (unknown).
 */
function shapeOf(expr, scope, listener, depth = 0) {
    expr = expr.trim();
    if (depth > 8)
        return null;
    if (/^(["'])[^"'\\]*\1$/.test(expr))
        return { kind: "string", value: expr.slice(1, -1) };
    if (expr === "undefined" || expr === "void 0")
        return { kind: "none" };
    if (expr.startsWith("{")) {
        const e = entries(expr);
        if (!e)
            return null;
        const keys = {};
        for (const [k, v] of e) {
            // A value that is no literal (a spread object, a variable) is there, as something.
            keys[k] = (/^[{"']/.test(v.trim()) ? shapeOf(v, scope, listener, depth + 1) : null) ?? { kind: "any" };
        }
        return { kind: "object", keys };
    }
    if (/^[A-Za-z_$][\w$]*$/.test(expr)) {
        const bound = scope?.get(expr);
        if (bound)
            return shapeOf(bound.expr, bound.scope, listener, depth + 1);
        return listener ? listener(expr) : null;
    }
    return null;
}
const helperCache = new WeakMap();
/** A top-level `function name(a, b)` in the package: its parameters, and the file. */
function helpers(sources) {
    const known = helperCache.get(sources);
    if (known)
        return known;
    const out = new Map();
    helperCache.set(sources, out);
    for (const s of sources) {
        for (const m of s.text.matchAll(/^function ([A-Za-z_$][\w$]*)\(([^)]*)\)\s*\{/gm)) {
            out.set(m[1], { params: m[2].split(",").map((p) => p.trim().replace(/\s*=.*$/, "")).filter(Boolean), source: s, body: m.index + m[0].length - 1 });
        }
    }
    return out;
}
/** The objects a piece of code runs commands with: `Interpreter.run({...})` and `new ...Context({...})`. */
function runObjects(text, from = 0, to = text.length) {
    const out = [];
    for (const m of text.slice(from, to).matchAll(/(?:Interpreter\.run|Context)\(\s*\{/g)) {
        const open = from + m.index + m[0].length - 1;
        const split = splitTopLevel(text, open);
        if (split)
            out.push(text.slice(open, split.end + 1));
    }
    return out;
}
/** The arguments of each `.emit("name", ...)` (or `safeEmit`, `emitter?.emit`) in the package. */
function emitSites(sources, name) {
    const out = [];
    const quoted = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const s of sources) {
        for (const m of s.text.matchAll(new RegExp(`\\b[A-Za-z]*[eE]mit\\??\\.?\\(\\s*(["'\`])${quoted}\\1`, "g"))) {
            const open = s.text.indexOf("(", m.index);
            const split = splitTopLevel(s.text, open);
            if (split)
                out.push(split.parts.slice(1));
        }
    }
    return out;
}
/**
 * How each of a package's events runs commands, from its handler: one {@link EventSite} per way (per
 * emit site, when the data comes from the listener's arguments). An empty list: not known.
 */
const siteCache = new WeakMap();
function eventSites(sources, event) {
    let known = siteCache.get(sources);
    if (!known)
        siteCache.set(sources, (known = new Map()));
    const hit = known.get(event);
    if (hit)
        return hit;
    const out = readSites(sources, event);
    known.set(event, out);
    return out;
}
function readSites(sources, event) {
    const quoted = event.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const handler = sources.find((s) => new RegExp(`\\bname:\\s*(["'\`])${quoted}\\1`).test(s.text) && /\blistener\b/.test(s.text) && !s.text.includes("NativeFunction"));
    if (!handler)
        return [];
    const text = handler.text;
    const params = /\blistener\s*(?::\s*(?:async\s+)?function\s*[\w$]*\s*)?\(([^)]*)\)/.exec(text)?.[1].split(",").map((p) => p.trim()).filter(Boolean) ?? [];
    const fns = helpers(sources);
    // The objects commands run with, and the scope their names are read in.
    const runs = runObjects(text).map((object) => ({ object, scope: null }));
    for (const m of text.matchAll(/([A-Za-z_$][\w$]*)\)?\(\s*this\s*,\s*(["'`])([^"'`]+)\2\s*[,)]/g)) {
        if (m[3] !== event)
            continue;
        const helper = fns.get(helperName(text, m.index, m[1]));
        const open = text.indexOf("(", m.index + m[1].length);
        const call = helper && splitTopLevel(text, open);
        if (!helper || !call)
            continue;
        const scope = new Map(helper.params.map((p, i) => [p, { expr: call.parts[i] ?? "undefined", scope: null }]));
        const end = splitTopLevel(helper.source.text, helper.body)?.end ?? helper.source.text.length;
        for (const object of runObjects(helper.source.text, helper.body, end))
            runs.push({ object, scope });
    }
    if (!runs.length)
        return [];
    const emits = emitSites(sources, event);
    const out = [];
    for (const run of runs) {
        const e = entries(run.object);
        if (!e)
            return [];
        // The listener's arguments: from each place the event is emitted. Without one, unknown.
        const perSite = emits.length ? emits : [null];
        for (const args of perSite) {
            const listener = (name) => {
                const i = params.indexOf(name);
                if (i < 0 || !args)
                    return null;
                const arg = args[i];
                return arg === undefined ? null : shapeOf(arg, null, null);
            };
            const read = (key) => (e.has(key) ? shapeOf(e.get(key), run.scope, listener) : undefined);
            const site = { extras: read("extras"), states: read("states") };
            if (!out.some((o) => JSON.stringify(o) === JSON.stringify(site)))
                out.push(site);
            // When neither comes from the listener, every emit site gives the same.
            if (!args || !/\b(extras|states)\b/.test(run.object))
                break;
        }
    }
    return out;
}
/**
 * The function a call names: `runCommands` for `(0, Handlers_1.runCommands)(...)`, and for
 * `(0, runEvent_1.default)(...)` the module's name, `runEvent` (TypeScript's output for a default import).
 */
function helperName(text, at, name) {
    if (name !== "default")
        return name;
    return /([A-Za-z_$][\w$]*?)_\d+\.$/.exec(text.slice(Math.max(0, at - 80), at))?.[1] ?? name;
}
/** A function's file reads its event's data: itself, or through a helper of its package it passes `ctx` to. */
function readsEventData(text, sources) {
    const body = text.slice(Math.max(0, text.indexOf("execute(")));
    if (/ctx\??\.(runtime\??\.extras|extendedStates)/.test(body))
        return true;
    const fns = helpers(sources);
    for (const m of body.matchAll(/([A-Za-z_$][\w$]*)\)?\(\s*ctx\b/g)) {
        const helper = fns.get(helperName(body, m.index, m[1]));
        if (!helper)
            continue;
        const end = splitTopLevel(helper.source.text, helper.body)?.end ?? helper.source.text.length;
        if (/\b\w+\??\.(runtime\??\.extras|extendedStates)/.test(helper.source.text.slice(helper.body, end)))
            return true;
    }
    return false;
}
/**
 * Runs each function that reads its events' data on stand-in data shaped like each event's, in a child
 * process (functions may be async, and a bad one must not take the checker down). `null` when the probe
 * could not run.
 */
function probeExtension(forgeDir, functions, events) {
    return probeExtensions(forgeDir, [{ functions, events }])?.[0] ?? null;
}
const probed = new Map();
/** {@link probeExtension} for several extensions in one child process, remembered for the process. */
function probeExtensions(forgeDir, packages) {
    if (!packages.some((p) => p.functions.length))
        return packages.map(() => null);
    const input = JSON.stringify({ forgeDir, packages });
    const known = probed.get(input);
    if (known)
        return known;
    // On disk too, for the next run: keyed by the input, the files' times and this version.
    let cache = null;
    try {
        const files = [path.join(forgeDir, "package.json"), path.join(__dirname, "probe.js"), ...packages.flatMap((p) => p.functions.map((f) => f.file))];
        const stamp = files.map((f) => `${f}:${fs.statSync(f).mtimeMs}`).join("|");
        const hash = require("node:crypto").createHash("sha256").update(input).update(stamp).update(require("../package.json").version).digest("hex").slice(0, 32);
        cache = path.join(require("node:os").tmpdir(), `reforgiparse-probe-${hash}.json`);
        const saved = JSON.parse(fs.readFileSync(cache, "utf8"));
        probed.set(input, saved);
        return saved;
    }
    catch {
        // Not cached yet (or no longer readable): run it.
    }
    try {
        const out = (0, node_child_process_1.execFileSync)(process.execPath, [path.join(__dirname, "probe.js")], {
            input,
            encoding: "utf8",
            timeout: 20000,
            maxBuffer: 16 * 1024 * 1024,
            stdio: ["pipe", "pipe", "ignore"],
        });
        const line = out.split("\n").reverse().find((l) => l.startsWith("["));
        if (!line)
            return null;
        const result = JSON.parse(line);
        probed.set(input, result);
        try {
            if (cache)
                fs.writeFileSync(cache, JSON.stringify(result));
        }
        catch {
            // A cache that cannot be written only costs time.
        }
        return result;
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=events.js.map