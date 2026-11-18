"use strict";
// SPDX-License-Identifier: LGPL-3.0-or-later
//
// `reforgiparse --lsp`: a language server over stdin and stdout, for any editor that speaks the
// Language Server Protocol (VS Code through a client extension, Neovim, Helix, Zed, ...).
//
// It gives the same diagnostics as the command line, as you type, and quick fixes: a name's letter
// case, escaping brackets that close a function too early, and turning a rule off for a line. It
// has no dependencies: the protocol is JSON-RPC with Content-Length headers, done here.
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
exports.serve = serve;
exports.offsetAt = offsetAt;
exports.positionAt = positionAt;
const path = __importStar(require("node:path"));
const node_url_1 = require("node:url");
const config_1 = require("./config");
const core_1 = require("./core");
const extract_1 = require("./extract");
const fix_1 = require("./fix");
const parser_1 = require("./parser");
const project_1 = require("./project");
const CODE_FILE = /\.(c|m)?(j|t)sx?$/;
const SEVERITY = { error: 1, warning: 2, info: 3 };
/** Runs a language server on the given streams (stdin and stdout by default) until `exit`. */
function serve(input = process.stdin, output = process.stdout) {
    const docs = new Map();
    const timers = new Map();
    let root = process.cwd();
    let project = null;
    let shuttingDown = false;
    // Kept before anything is redirected: load() points process.stdout at stderr while ForgeScript
    // loads, and the protocol must still reach the editor then.
    const write = output.write.bind(output);
    const send = (msg) => {
        const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", ...msg }), "utf8");
        write(`Content-Length: ${body.length}\r\n\r\n`);
        write(body);
    };
    const notify = (method, params) => send({ method, params });
    const log = (message, type = 4) => notify("window/logMessage", { type, message: `reforgiparse: ${message}` });
    /** Loads the bot's functions and config. Anything ForgeScript prints goes to stderr, never into the protocol. */
    const load = () => {
        const write = process.stdout.write;
        process.stdout.write = process.stderr.write.bind(process.stderr);
        try {
            project = project_1.Project.load(root);
            for (const note of project.notes)
                log(note, 2);
        }
        catch (e) {
            project = null;
            const message = e instanceof config_1.ConfigError ? `config: ${e.message}` : `cannot load the bot in ${root}: ${e.message}`;
            log(message, 1);
            notify("window/showMessage", { type: 1, message: `ReForgiParse: ${message}` });
        }
        finally {
            process.stdout.write = write;
        }
    };
    const fileOf = (uri) => {
        try {
            return uri.startsWith("file:") ? (0, node_url_1.fileURLToPath)(uri) : null;
        }
        catch {
            return null;
        }
    };
    const diagnose = (uri) => {
        const doc = docs.get(uri);
        const file = fileOf(uri);
        if (!doc || !file || !project || !CODE_FILE.test(file))
            return [];
        const rel = path.relative(project.root, file).split(path.sep).join("/");
        return (0, core_1.checkScript)(doc.text, project.table, { file: rel, properties: project.properties, values: project.values, events: project.events, rules: project.config.rules });
    };
    const publish = (uri) => {
        const doc = docs.get(uri);
        const diagnostics = diagnose(uri).map((d) => ({
            range: { start: { line: d.line - 1, character: d.column - 1 }, end: { line: d.endLine - 1, character: Math.max(d.endColumn - 1, d.column) } },
            severity: SEVERITY[d.severity],
            code: d.rule,
            source: "reforgiparse",
            message: d.message,
        }));
        notify("textDocument/publishDiagnostics", { uri, version: doc?.version, diagnostics });
    };
    const schedule = (uri) => {
        clearTimeout(timers.get(uri));
        timers.set(uri, setTimeout(() => publish(uri), 120));
    };
    const handle = (msg) => {
        const reply = (result) => msg.id !== undefined && send({ id: msg.id, result });
        const p = msg.params ?? {};
        switch (msg.method) {
            case "initialize": {
                const folder = p.workspaceFolders?.[0]?.uri ?? p.rootUri;
                const fromUri = folder ? fileOf(folder) : null;
                root = fromUri ?? p.rootPath ?? process.cwd();
                load();
                return reply({
                    capabilities: {
                        textDocumentSync: { openClose: true, change: 1, save: { includeText: false } },
                        codeActionProvider: { codeActionKinds: ["quickfix", "source.fixAll"] },
                    },
                    serverInfo: { name: "reforgiparse", version: require("../package.json").version },
                });
            }
            case "initialized":
                return;
            case "textDocument/didOpen":
                docs.set(p.textDocument.uri, { text: p.textDocument.text, version: p.textDocument.version });
                return publish(p.textDocument.uri);
            case "textDocument/didChange": {
                const doc = docs.get(p.textDocument.uri);
                const last = p.contentChanges?.[p.contentChanges.length - 1];
                if (doc && last && typeof last.text === "string" && !last.range) {
                    doc.text = last.text;
                    doc.version = p.textDocument.version;
                    schedule(p.textDocument.uri);
                }
                return;
            }
            case "textDocument/didSave":
                // A saved file can define custom functions or be the config: read the bot again.
                load();
                for (const uri of docs.keys())
                    publish(uri);
                return;
            case "textDocument/didClose":
                docs.delete(p.textDocument.uri);
                clearTimeout(timers.get(p.textDocument.uri));
                notify("textDocument/publishDiagnostics", { uri: p.textDocument.uri, diagnostics: [] });
                return;
            case "textDocument/codeAction":
                return reply(codeActions(p.textDocument.uri, p.range, p.context?.diagnostics ?? [], p.context?.only));
            case "shutdown":
                shuttingDown = true;
                return reply(null);
            case "exit":
                process.exit(shuttingDown ? 0 : 1);
            default:
                if (msg.id !== undefined && msg.method)
                    send({ id: msg.id, error: { code: -32601, message: `${msg.method} is not supported` } });
        }
    };
    const codeActions = (uri, range, diagnostics, only) => {
        const doc = docs.get(uri);
        if (!doc || !project)
            return [];
        const text = doc.text;
        const actions = [];
        const want = (kind) => !only || only.some((k) => kind === k || kind.startsWith(`${k}.`));
        const whole = (newText) => ({ changes: { [uri]: [{ range: { start: { line: 0, character: 0 }, end: positionAt(text, text.length) }, newText }] } });
        const options = { properties: project.properties };
        for (const d of diagnostics.filter((x) => x.source === "reforgiparse")) {
            if (d.code === "function-case" && want("quickfix")) {
                const start = offsetAt(text, d.range.start);
                const fix = (0, fix_1.fixText)(text, project.table, { ...options }).fixes.find((f) => f.offset === start);
                const to = fix?.description.split(" → $")[1];
                if (fix && to)
                    actions.push({ title: `Write $${to}`, kind: "quickfix", diagnostics: [d], isPreferred: true, edit: { changes: { [uri]: [{ range: { start: d.range.start, end: positionAt(text, start + to.length) }, newText: to }] } } });
            }
            if (d.code === "unescaped-bracket" && want("quickfix")) {
                const r = (0, fix_1.fixText)(text, project.table, { ...options, case: false, brackets: true });
                if (r.text !== text)
                    actions.push({ title: "Escape the brackets so the text is printed as written (changes what the bot sends)", kind: "quickfix", diagnostics: [d], edit: whole(r.text) });
            }
            if (want("quickfix")) {
                const edit = disableLine(text, d, project);
                if (edit)
                    actions.push({ title: `Turn ${d.code} off for this line`, kind: "quickfix", diagnostics: [d], edit: { changes: { [uri]: [edit] } } });
            }
        }
        if (want("source.fixAll")) {
            const r = (0, fix_1.fixText)(text, project.table, { ...options });
            if (r.text !== text)
                actions.push({ title: "Fix all names' letter case (ReForgiParse)", kind: "source.fixAll.reforgiparse", edit: whole(r.text) });
        }
        void range;
        return actions;
    };
    // Content-Length framed JSON-RPC on the input stream.
    let buffer = Buffer.alloc(0);
    input.on("data", (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        for (;;) {
            const headerEnd = buffer.indexOf("\r\n\r\n");
            if (headerEnd < 0)
                return;
            const length = /Content-Length: *(\d+)/i.exec(buffer.subarray(0, headerEnd).toString("ascii"));
            if (!length) {
                buffer = buffer.subarray(headerEnd + 4);
                continue;
            }
            const end = headerEnd + 4 + Number(length[1]);
            if (buffer.length < end)
                return;
            const body = buffer.subarray(headerEnd + 4, end).toString("utf8");
            buffer = buffer.subarray(end);
            let msg;
            try {
                msg = JSON.parse(body);
            }
            catch {
                send({ id: null, error: { code: -32700, message: "Parse error" } });
                continue;
            }
            try {
                handle(msg);
            }
            catch (e) {
                if (msg.id !== undefined)
                    send({ id: msg.id, error: { code: -32603, message: e.message } });
                else
                    log(`error handling ${msg.method}: ${e.message}`, 1);
            }
        }
    });
    input.on("end", () => process.exit(shuttingDown ? 0 : 1));
}
/** LSP position (0-based line, UTF-16 character) to a text offset. */
function offsetAt(text, pos) {
    let offset = 0;
    for (let line = 0; line < pos.line; line++) {
        const next = text.indexOf("\n", offset);
        if (next < 0)
            return text.length;
        offset = next + 1;
    }
    return Math.min(offset + pos.character, text.length);
}
/** A text offset to an LSP position. */
function positionAt(text, offset) {
    const head = text.slice(0, offset);
    const line = head.split("\n").length - 1;
    return { line, character: offset - (head.lastIndexOf("\n") + 1) };
}
/** The calls of a parse, without any `$c[...]`: what the code does, apart from comments. */
function withoutComments(res) {
    const comment = new Set();
    const mark = (calls) => {
        for (const c of calls) {
            if (c.name === "$c")
                comment.add(c.index);
            for (const f of c.fields ?? [])
                for (const x of f.kind === "condition" ? [f.lhs, ...(f.rhs ? [f.rhs] : [])] : [f])
                    mark(x.functions);
        }
    };
    mark(res.functions);
    const text = (v) => v.replace(/\[SYSTEM_FUNCTION\((\d+)\)\]/g, (_, n) => (comment.has(Number(n)) ? "" : "[F]"));
    const field = (f) => (f.kind === "condition" ? [f.op, field(f.lhs), f.rhs && field(f.rhs)] : [text(f.value), calls(f.functions)]);
    const calls = (cs) => cs.filter((c) => c.name !== "$c").map((c) => [c.name, c.negated, c.silent, c.count, c.fields?.map(field) ?? null]);
    return JSON.stringify([text(res.code), calls(res.functions), res.errors.map((e) => e.kind)]);
}
/**
 * An edit that turns a rule off for a diagnostic's line: `$c[reforgiparse-disable-line rule]` at the
 * end of that line of code (which prints nothing), or a JavaScript comment above a line outside the
 * code. Only when the code then does the same apart from that comment.
 */
function disableLine(text, d, project) {
    const line = d.range.start.line;
    const lineStart = offsetAt(text, { line, character: 0 });
    let lineEnd = text.indexOf("\n", lineStart);
    if (lineEnd < 0)
        lineEnd = text.length;
    if (text[lineEnd - 1] === "\r")
        lineEnd--;
    const sources = (0, extract_1.extractCode)(text, project.properties);
    const src = sources.find((s) => s.start < lineEnd && lineStart < s.end);
    const directive = `reforgiparse-disable-line ${d.code}`;
    if (!src || src.error) {
        // A line of JavaScript (a command's type, say): a comment on the line above.
        if (sources.some((s) => s.start < lineStart && lineStart < s.end))
            return null;
        const indent = /^[ \t]*/.exec(text.slice(lineStart, lineEnd))[0];
        return { range: { start: positionAt(text, lineStart), end: positionAt(text, lineStart) }, newText: `${indent}// reforgiparse-disable-next-line ${d.code}\n` };
    }
    // Inside the code: at the end of the line, or before the closing quote when the code ends on it.
    const at = src.end - 1 < lineEnd ? src.end - 1 : lineEnd;
    if (text[at - 1] === "\\")
        return null;
    const next = text.slice(0, at) + `$c[${directive}]` + text.slice(at);
    const after = (0, extract_1.extractCode)(next, project.properties).find((s) => s.start === src.start);
    if (!after || withoutComments((0, parser_1.parse)(after.value, project.table, { recover: true })) !== withoutComments((0, parser_1.parse)(src.value, project.table, { recover: true })))
        return null;
    return { range: { start: positionAt(text, at), end: positionAt(text, at) }, newText: `$c[${directive}]` };
}
//# sourceMappingURL=lsp.js.map