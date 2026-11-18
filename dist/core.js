"use strict";
// SPDX-License-Identifier: LGPL-3.0-or-later
//
// ReForgiParse's checks on one file's text, with no file access and no ForgeScript needed: for an
// editor extension, a browser, or any tool that has the text and the functions. The command line
// and the language server use the same function.
//
//   const { checkScript, FunctionTable } = require("reforgiparse/core")
//   const table = FunctionTable.fromMetadata(extensionFunctions, forgeScriptFunctions)
//   checkScript(text, table) // [{ line, column, endLine, endColumn, severity, rule, message, ... }]
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
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProjectRules = void 0;
exports.checkScript = checkScript;
exports.closest = closest;
const directives_1 = require("./directives");
const extract_1 = require("./extract");
const rules_1 = require("./rules");
/** Rules that need the whole file, not only the code: what they find and their default level. */
exports.ProjectRules = {
    "unknown-event": { severity: "error", description: "A command's `type` that no loaded package has as an event: the command never runs." },
    "unreadable-string": { severity: "warning", description: "A `code:` string JavaScript would not end where it seems to: it is not checked." },
    "unknown-rule": { severity: "warning", description: "A `reforgiparse-disable` comment that names no rule: it turns nothing off." },
};
/** Every problem in one JavaScript or TypeScript file's text, with directives and levels applied. */
function checkScript(text, table, options = {}) {
    const file = options.file ?? "";
    const properties = options.properties?.length ? options.properties : ["code"];
    const found = [];
    const objects = objectLiterals(text);
    const lineColumn = (0, extract_1.lineIndex)(text);
    for (const src of (0, extract_1.extractCode)(text, properties))
        found.push(...checkSource(text, lineColumn, file, src, innermost(objects, src), table, options));
    // Comments that turn rules off; one that names no rule is reported (forgelint- ones may name ForgeLint's rules).
    const directives = (0, directives_1.directivesIn)(text);
    for (const d of directives) {
        if (d.prefix !== "reforgiparse")
            continue;
        for (const rule of d.rules) {
            if (rule in rules_1.Rules || rule in exports.ProjectRules)
                continue;
            const guess = closest(rule, [...Object.keys(rules_1.Rules), ...Object.keys(exports.ProjectRules)]);
            found.push({ file, line: d.line, column: d.column, endLine: d.line, endColumn: d.column + 1, severity: "warning", rule: "unknown-rule", message: `reforgiparse-${d.kind} names "${rule}", which is not a rule, so it turns nothing off${guess ? `. Did you mean "${guess}"?` : ""}` });
        }
    }
    const levels = options.rules ?? {};
    const out = [];
    for (const d of found) {
        const level = levels[d.rule];
        if (level === "off" || (0, directives_1.isSuppressed)(directives, d.line, d.rule))
            continue;
        out.push(level ? { ...d, severity: level } : d);
    }
    return out.sort((a, b) => a.line - b.line || a.column - b.column);
}
/** The innermost object literal around a code string. Objects are in order of their `{`, and nest. */
function innermost(objects, src) {
    // The last object opened before the string, then outwards until one also ends after it.
    let lo = 0;
    let hi = objects.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (objects[mid].start < src.start)
            lo = mid + 1;
        else
            hi = mid;
    }
    for (let i = lo - 1; i >= 0; i--)
        if (src.end <= objects[i].end)
            return objects[i];
    return undefined;
}
function checkSource(text, lineColumn, file, src, obj, table, options) {
    const out = [];
    const at = (start, end, severity, rule, message) => {
        const a = lineColumn((0, extract_1.fileOffset)(src, start));
        const b = lineColumn(end > start ? (0, extract_1.fileOffset)(src, end - 1) + 1 : (0, extract_1.fileOffset)(src, start));
        out.push({ file, line: a.line, column: a.column, endLine: b.line, endColumn: b.column, severity, rule, message });
    };
    if (src.error) {
        const a = lineColumn(src.start);
        out.push({ file, line: a.line, column: a.column, endLine: a.line, endColumn: a.column + 1, severity: "warning", rule: "unreadable-string", message: `This ${src.property}: string cannot be read to its end (${src.error}), so it was not checked` });
        return out;
    }
    // The body of a custom function ({ name, params, code }, or any object in a functions folder) can read the caller's variables.
    const custom = !!obj && (obj.props.has("params") || (file.split("/").slice(0, -1).includes("functions") && obj.props.has("name")));
    for (const f of (0, rules_1.checkCode)(src.value, table, { values: options.values, customFunction: custom })) {
        // A name right before a ${...} may be completed when the bot runs.
        if ((f.rule === "unknown-function" || f.rule === "glued-name") && src.value[f.end] === extract_1.DYNAMIC)
            continue;
        at(f.start, f.end, f.severity, f.rule, f.message);
    }
    // The command's type, in the same object as its code. Application commands (with `data`) are skipped.
    const type = obj?.props.get("type");
    if (options.events && obj && type && !obj.props.has("data") && !type.dynamic && !type.error && !options.events.has(type.value)) {
        const a = lineColumn(type.start);
        const b = lineColumn(type.end);
        const guess = closest(type.value, options.events);
        out.push({ file, line: a.line, column: a.column, endLine: b.line, endColumn: b.column, severity: "error", rule: "unknown-event", message: `"${type.value}" is not an event of ForgeScript or its extensions here, so this command never runs${guess ? `. Did you mean "${guess}"?` : ""}` });
    }
    return out;
}
/** Every object literal in a file, with its own properties, skipping strings and comments. */
function objectLiterals(text) {
    const out = [];
    const stack = [];
    const key = /([A-Za-z_$][\w$]*|"[^"\n]*"|'[^'\n]*')\s*:/y;
    let expectKey = false;
    for (let i = 0; i < text.length;) {
        const c = text[i];
        if (c === "/" && (text[i + 1] === "/" || text[i + 1] === "*")) {
            i = (0, extract_1.skipComment)(text, i);
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
        if (c === "/" && (0, extract_1.regexCanStart)(text, i)) {
            i = (0, extract_1.skipRegex)(text, i);
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
function closest(word, names) {
    let best = null;
    let bestD = Infinity;
    for (const n of names) {
        const d = (0, rules_1.distance)(word.toLowerCase(), n.toLowerCase());
        if (d < bestD)
            (bestD = d), (best = n);
    }
    return bestD <= Math.max(1, Math.floor(word.length / 4)) ? best : null;
}
__exportStar(require("./table"), exports);
__exportStar(require("./parser"), exports);
__exportStar(require("./names"), exports);
__exportStar(require("./extract"), exports);
__exportStar(require("./rules"), exports);
__exportStar(require("./values"), exports);
__exportStar(require("./fix"), exports);
__exportStar(require("./directives"), exports);
//# sourceMappingURL=core.js.map