"use strict"
// reforgiparse/core as an editor extension or a browser would use it: in a process with no
// ForgeScript and no file reading, given only function metadata (the metadata/functions.json format)
// and a file's text. It must find what the full check finds, apart from what needs ForgeScript
// itself (argument values, events).
const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { spawnSync } = require("node:child_process")
const forgescript = require("@tryforge/forgescript")
const { FunctionTable, checkScript, ValueChecker } = require("..")

const TEXT = [
    "module.exports = { name: 'x', type: 'messageCreate', code: `$AUTHORID $pingms",
    "$sendMesage[$channelID;hi]",
    "$if[yes;a;b] $description[[a](b)] $let[x;1] $get[a` }",
].join("\n")

test("core runs with only metadata and text: no ForgeScript, no file access, same findings", () => {
    forgescript.FunctionManager.loadNative()
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reforgiparse-core-"))
    const meta = path.join(dir, "functions.json")
    fs.writeFileSync(meta, JSON.stringify(forgescript.FunctionManager.toJSON(), (_, v) => (typeof v === "bigint" ? String(v) : v)))
    const script = `
        const before = new Set(Object.keys(require.cache))
        const core = require("reforgiparse/core")
        const loaded = Object.keys(require.cache).filter((k) => !before.has(k))
        const metadata = JSON.parse(require("node:fs").readFileSync(${JSON.stringify(meta)}, "utf8"))
        const table = core.FunctionTable.fromMetadata(metadata)
        const found = core.checkScript(${JSON.stringify(TEXT)}, table, { file: "a.js" })
        process.stdout.write(JSON.stringify({ loaded, found }))`
    const r = spawnSync(process.execPath, ["-e", script], { cwd: path.join(__dirname, ".."), encoding: "utf8" })
    assert.equal(r.status, 0, r.stderr)
    const { loaded, found } = JSON.parse(r.stdout)
    assert.ok(loaded.length > 0)
    assert.deepEqual(loaded.filter((m) => /forgescript|discord\.js|[\\/](config|project|cli|lsp)\.js$/.test(m)), [], "core loads neither ForgeScript nor the modules that read files")

    // The full check, with ForgeScript's resolvers: core finds the same, apart from argument values.
    const table = FunctionTable.fromForgeScript(forgescript)
    const full = checkScript(TEXT, table, { file: "a.js", values: new ValueChecker(forgescript, require("discord.js")) })
    const key = (d) => `${d.line}:${d.column} ${d.rule}`
    assert.deepEqual(found.map(key), full.map(key))
    assert.deepEqual(found.map((d) => d.rule).sort(), ["condition-operator", "function-case", "glued-name", "unclosed-bracket", "unescaped-bracket", "unknown-function"])
})

test("a file being typed: unfinished comments, strings, templates and regexes end the check, never hang it", () => {
    forgescript.FunctionManager.loadNative()
    const table = FunctionTable.fromForgeScript(forgescript)
    const head = 'module.exports = { type: "messageCreate", code: "$pingms" }\n'
    for (const tail of ["/* still typing", "/*", "// no newline", "'unterminated", "`template $ping", "`${a", "`${'", "const r = /[", "{ code: `$ping", "{ 'code'", "/"]) {
        const started = Date.now()
        const found = checkScript(head + tail, table)
        assert.ok(Date.now() - started < 1000, `${JSON.stringify(tail)} took ${Date.now() - started} ms`)
        assert.ok(found.some((d) => d.rule === "glued-name"), JSON.stringify(tail))
    }
})

test("FunctionTable.fromForgeScript() loads ForgeScript's functions when nothing has yet", () => {
    // A fresh process, as a script that never called FunctionManager.loadNative().
    const r = spawnSync(process.execPath, ["-e", 'const { FunctionTable } = require("."); const t = FunctionTable.fromForgeScript(); console.log(t.functions.length, !!t.get("$sendMessage"))'], { cwd: path.join(__dirname, ".."), encoding: "utf8" })
    assert.equal(r.status, 0, r.stderr)
    const [count, found] = r.stdout.trim().split(" ")
    assert.ok(Number(count) > 1000, r.stdout)
    assert.equal(found, "true")
    assert.doesNotMatch(r.stderr, /Attempted to override/)
})
