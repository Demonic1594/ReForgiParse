"use strict"
// The language server, spoken to as an editor would: a real `reforgiparse --lsp` process, framed
// JSON-RPC on its stdin and stdout. Its diagnostics must match the command line's, its quick fixes
// must remove what they fix once applied, and nothing but protocol may reach stdout.
const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { spawn } = require("node:child_process")
const { pathToFileURL } = require("node:url")
const { Project } = require("..")

const CLI = path.join(__dirname, "..", "dist", "cli.js")
const MODULES = path.join(__dirname, "..", "node_modules")

function bot(files) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reforgiparse-lsp-"))
    fs.symlinkSync(MODULES, path.join(dir, "node_modules"), "dir")
    const all = { "package.json": JSON.stringify({ name: "bot", dependencies: { "@tryforge/forgescript": "2.8.0" } }), ...files }
    for (const [name, text] of Object.entries(all)) {
        fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true })
        fs.writeFileSync(path.join(dir, name), text)
    }
    return dir
}

/** An LSP client on a spawned server. Every byte the server writes to stdout must be a framed message. */
function client(dir) {
    const server = spawn(process.execPath, [CLI, "--lsp"], { cwd: dir, stdio: ["pipe", "pipe", "pipe"] })
    servers.push(server)
    let stderr = ""
    server.stderr.on("data", (d) => (stderr += d))
    let buffer = Buffer.alloc(0)
    let id = 0
    const pending = new Map()
    const notifications = []
    const waiters = []
    server.stdout.on("data", (chunk) => {
        buffer = Buffer.concat([buffer, chunk])
        for (;;) {
            const head = buffer.indexOf("\r\n\r\n")
            if (head < 0) return
            const header = buffer.subarray(0, head).toString("ascii")
            const m = /^Content-Length: (\d+)$/.exec(header)
            assert.ok(m, `stdout carries only framed messages; got ${JSON.stringify(header.slice(0, 80))}`)
            const end = head + 4 + Number(m[1])
            if (buffer.length < end) return
            const msg = JSON.parse(buffer.subarray(head + 4, end).toString("utf8"))
            buffer = buffer.subarray(end)
            if (msg.id !== undefined && pending.has(msg.id)) {
                pending.get(msg.id)(msg)
                pending.delete(msg.id)
            } else {
                notifications.push(msg)
                for (const w of [...waiters]) if (w.test(msg)) waiters.splice(waiters.indexOf(w), 1), w.resolve(msg)
            }
        }
    })
    const write = (msg) => {
        const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", ...msg }), "utf8")
        server.stdin.write(`Content-Length: ${body.length}\r\n\r\n`)
        server.stdin.write(body)
    }
    return {
        server,
        stderr: () => stderr,
        request: (method, params) => new Promise((resolve) => {
            const n = ++id
            pending.set(n, resolve)
            write({ id: n, method, params })
        }),
        notify: (method, params) => write({ method, params }),
        /** The next notification of a method after this call. */
        next: (method) => new Promise((resolve) => waiters.push({ test: (m) => m.method === method, resolve: (m) => resolve(m.params) })),
        /** The next publishDiagnostics for a document after this call. */
        diagnostics: (uri) => new Promise((resolve) => waiters.push({ test: (m) => m.method === "textDocument/publishDiagnostics" && m.params.uri === uri, resolve: (m) => resolve(m.params.diagnostics) })),
        exited: new Promise((resolve) => server.on("exit", (code) => resolve(code))),
    }
}

// A failed assertion must fail the test, not leave a server running that keeps the test alive.
const servers = []
const { after } = require("node:test")
after(() => servers.forEach((s) => s.exitCode === null && s.kill()))

/** Applies a WorkspaceEdit's edits for one document to its text. */
function apply(text, edit, uri) {
    const offset = ({ line, character }) => {
        let o = 0
        for (let l = 0; l < line; l++) o = text.indexOf("\n", o) + 1
        return o + character
    }
    const edits = [...edit.changes[uri]].sort((a, b) => offset(b.range.start) - offset(a.range.start))
    for (const e of edits) text = text.slice(0, offset(e.range.start)) + e.newText + text.slice(offset(e.range.end))
    return text
}

const SOURCE = [
    "module.exports = [{",
    '    name: "shop",',
    '    type: "messageCreat",',
    "    code: `$AUTHORID",
    "$pingms",
    "$description[[Docs](https://x.y)]`",
    "}]",
    "",
].join("\n")

test("diagnostics as the command line gives them, and each quick fix removes its problem", async () => {
    const dir = bot({ "commands/shop.js": SOURCE })
    const file = path.join(dir, "commands/shop.js")
    const uri = pathToFileURL(file).href
    const c = client(dir)
    const init = await c.request("initialize", { processId: process.pid, rootUri: pathToFileURL(dir).href, capabilities: {} })
    assert.equal(init.result.capabilities.textDocumentSync.change, 1)
    assert.ok(init.result.capabilities.codeActionProvider)
    assert.equal(init.result.serverInfo.name, "reforgiparse")
    c.notify("initialized", {})

    let text = SOURCE
    let version = 1
    const open = c.diagnostics(uri)
    c.notify("textDocument/didOpen", { textDocument: { uri, languageId: "javascript", version, text } })
    let diags = await open

    // The same problems, at the same places, as the command line.
    const cli = Project.load(dir).check()
    assert.deepEqual(
        diags.map((d) => [d.code, d.range.start.line + 1, d.range.start.character + 1, d.severity]).sort(),
        cli.map((d) => [d.rule, d.line, d.column, { error: 1, warning: 2, info: 3 }[d.severity]]).sort(),
    )
    assert.deepEqual(diags.map((d) => d.code).sort(), ["function-case", "glued-name", "unescaped-bracket", "unknown-event"])

    const action = async (code, title) => {
        const d = diags.find((x) => x.code === code)
        assert.ok(d, `a ${code} diagnostic`)
        const res = await c.request("textDocument/codeAction", { textDocument: { uri }, range: d.range, context: { diagnostics: [d] } })
        const a = res.result.find((x) => title.test(x.title))
        assert.ok(a, `an action ${title} for ${code}; got ${JSON.stringify(res.result.map((x) => x.title))}`)
        return a
    }
    const change = async (next) => {
        text = next
        const p = c.diagnostics(uri)
        c.notify("textDocument/didChange", { textDocument: { uri, version: ++version }, contentChanges: [{ text }] })
        diags = await p
    }

    // A name's letter case: only that name changes.
    const caseFix = await action("function-case", /^Write \$authorID$/)
    await change(apply(text, caseFix.edit, uri))
    assert.match(text, /code: `\$authorID\n/)
    assert.ok(!diags.some((d) => d.code === "function-case"))

    // Turning glued-name off for its line, in the code: $c[...], which prints nothing.
    const off = await action("glued-name", /^Turn glued-name off for this line$/)
    await change(apply(text, off.edit, uri))
    assert.match(text, /\n\$pingms\$c\[reforgiparse-disable-line glued-name\]\n/)
    assert.ok(!diags.some((d) => d.code === "glued-name"))

    // Turning unknown-event off: a JavaScript comment above the type line.
    const offEvent = await action("unknown-event", /^Turn unknown-event off for this line$/)
    await change(apply(text, offEvent.edit, uri))
    assert.match(text, /\n {4}\/\/ reforgiparse-disable-next-line unknown-event\n {4}type: "messageCreat",/)
    assert.ok(!diags.some((d) => d.code === "unknown-event"))

    // Escaping brackets, which changes what the bot sends, and says so.
    const brackets = await action("unescaped-bracket", /^Escape the brackets .*\(changes what the bot sends\)$/)
    await change(apply(text, brackets.edit, uri))
    assert.match(text, /\$description\[\\\\\[Docs\\\\\]\(https:\/\/x\.y\)\]`/)
    assert.deepEqual(diags, [])

    assert.deepEqual((await c.request("shutdown", null)).result, null)
    c.notify("exit", null)
    assert.equal(await c.exited, 0)
})

test("fix-all, a closed document, unknown requests, and a broken config reported to the editor", async () => {
    const dir = bot({ "commands/a.js": "module.exports = { code: `$AUTHORID $PING` }\n", "reforgiparse.config.json": "{ broken" })
    const uri = pathToFileURL(path.join(dir, "commands/a.js")).href
    const c = client(dir)
    const shown = c.next("window/showMessage")
    await c.request("initialize", { processId: process.pid, rootUri: pathToFileURL(dir).href, capabilities: {} })
    const message = await shown
    assert.equal(message.type, 1)
    assert.match(message.message, /^ReForgiParse: config: .*reforgiparse\.config\.json: is not valid JSON/)
    // With a broken config there is no project: no diagnostics, and the editor is told why.
    const none = c.diagnostics(uri)
    c.notify("textDocument/didOpen", { textDocument: { uri, languageId: "javascript", version: 1, text: "module.exports = { code: `$AUTHORID $PING` }\n" } })
    assert.deepEqual(await none, [])

    fs.writeFileSync(path.join(dir, "reforgiparse.config.json"), "{}")
    const after = c.diagnostics(uri)
    c.notify("textDocument/didSave", { textDocument: { uri } })
    assert.deepEqual((await after).map((d) => d.code), ["function-case", "function-case"])
    // Reading the bot again does not register ForgeScript's functions a second time (ForgeScript warns then).
    const again = c.diagnostics(uri)
    c.notify("textDocument/didSave", { textDocument: { uri } })
    await again
    assert.doesNotMatch(c.stderr(), /Attempted to override/)

    const res = await c.request("textDocument/codeAction", { textDocument: { uri }, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, context: { diagnostics: [], only: ["source.fixAll"] } })
    assert.equal(res.result.length, 1)
    assert.equal(apply("module.exports = { code: `$AUTHORID $PING` }\n", res.result[0].edit, uri), "module.exports = { code: `$authorID $ping` }\n")

    const unknown = await c.request("textDocument/definition", { textDocument: { uri }, position: { line: 0, character: 0 } })
    assert.equal(unknown.error.code, -32601)

    const closed = c.diagnostics(uri)
    c.notify("textDocument/didClose", { textDocument: { uri } })
    assert.deepEqual(await closed, [])
    await c.request("shutdown", null)
    c.notify("exit", null)
    assert.equal(await c.exited, 0)
})

test("turning a rule off is not offered where $c[...] would change the code", async () => {
    // The line ends with an escape: $c[...] after it would be printed as text, not run.
    const text = "module.exports = { code: `$pingms \\\\\n$pingms` }\n"
    const dir = bot({ "commands/a.js": text })
    const uri = pathToFileURL(path.join(dir, "commands/a.js")).href
    const c = client(dir)
    await c.request("initialize", { processId: process.pid, rootUri: pathToFileURL(dir).href, capabilities: {} })
    const open = c.diagnostics(uri)
    c.notify("textDocument/didOpen", { textDocument: { uri, languageId: "javascript", version: 1, text } })
    const diags = (await open).filter((d) => d.code === "glued-name")
    assert.deepEqual(diags.map((d) => d.range.start.line), [0, 1])
    const titles = async (d) => (await c.request("textDocument/codeAction", { textDocument: { uri }, range: d.range, context: { diagnostics: [d] } })).result.map((a) => a.title)
    assert.deepEqual(await titles(diags[0]), [], "not on the line ending with an escape")
    assert.deepEqual(await titles(diags[1]), ["Turn glued-name off for this line"])
    await c.request("shutdown", null)
    c.notify("exit", null)
    assert.equal(await c.exited, 0)
})

test("hover shows a function's usage and description, and completion offers names inside code only", async () => {
    const text = "module.exports = { name: 'x', type: 'messageCreate', code: `$sendMessage[$channelID;hi] \\\\$se $!sendM` }\nconst other = '$send'\n"
    const dir = bot({ "commands/a.js": text })
    const uri = pathToFileURL(path.join(dir, "commands/a.js")).href
    const c = client(dir)
    const init = await c.request("initialize", { processId: process.pid, rootUri: pathToFileURL(dir).href, capabilities: { textDocument: { completion: { completionItem: { snippetSupport: true } } } } })
    assert.ok(init.result.capabilities.hoverProvider)
    assert.deepEqual(init.result.capabilities.completionProvider.triggerCharacters, ["$"])
    const open = c.diagnostics(uri)
    c.notify("textDocument/didOpen", { textDocument: { uri, languageId: "javascript", version: 1, text } })
    await open
    const at = (needle, plus = 0) => ({ line: 0, character: text.indexOf(needle) + plus })

    // Hover on a name: its usage, description, arguments and package; nothing on text or outside code.
    const hover = (await c.request("textDocument/hover", { textDocument: { uri }, position: at("$sendMessage", 4) })).result
    assert.match(hover.contents.value, /^```\n\$sendMessage\[channel ID;content\?;return message ID\?\]\n```\n\nSends a message to a channel\n\n- `channel ID` Channel\n/)
    assert.match(hover.contents.value, /@tryforge\/forgescript$/)
    assert.deepEqual(hover.range, { start: at("$sendMessage"), end: at("$sendMessage", "$sendMessage".length) })
    assert.equal((await c.request("textDocument/hover", { textDocument: { uri }, position: at("hi]", 1) })).result, null)
    assert.equal((await c.request("textDocument/hover", { textDocument: { uri }, position: at("exports") })).result, null)

    // Completion of the name being written, after $ and its ! # @[...] flags.
    const done = (await c.request("textDocument/completion", { textDocument: { uri }, position: at("$!sendM", 7) })).result
    const item = done.items.find((i) => i.label === "$sendMessage")
    assert.ok(item, "$sendMessage is offered")
    assert.equal(item.textEdit.newText, "sendMessage[$0]")
    assert.equal(item.insertTextFormat, 2)
    assert.deepEqual(item.textEdit.range, { start: at("$!sendM", 2), end: at("$!sendM", 7) })
    assert.ok(done.items.some((i) => i.label === "$serverID" && /\(alias\)$/.test(i.detail)), "aliases too")
    const resolved = (await c.request("completionItem/resolve", item)).result
    assert.match(resolved.documentation.value, /Sends a message to a channel/)
    // Not after an escaped \$, and not in strings that are not code.
    assert.deepEqual((await c.request("textDocument/completion", { textDocument: { uri }, position: at("\\$se", 4) })).result.items, [])
    assert.deepEqual((await c.request("textDocument/completion", { textDocument: { uri }, position: { line: 1, character: 20 } })).result.items, [])

    await c.request("shutdown", null)
    c.notify("exit", null)
    assert.equal(await c.exited, 0)
})

test("a document with an unfinished comment gets its diagnostics, and the server keeps answering", async () => {
    const text = "module.exports = { code: `$pingms` }\n/* still typing"
    const dir = bot({ "commands/a.js": text })
    const uri = pathToFileURL(path.join(dir, "commands/a.js")).href
    const c = client(dir)
    await c.request("initialize", { processId: process.pid, rootUri: pathToFileURL(dir).href, capabilities: {} })
    const open = c.diagnostics(uri)
    c.notify("textDocument/didOpen", { textDocument: { uri, languageId: "javascript", version: 1, text } })
    assert.deepEqual((await open).map((d) => d.code), ["glued-name"])
    assert.equal((await c.request("textDocument/hover", { textDocument: { uri }, position: { line: 0, character: 27 } })).result.contents.kind, "markdown")
    await c.request("shutdown", null)
    c.notify("exit", null)
    assert.equal(await c.exited, 0)
})
