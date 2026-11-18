"use strict"
// The config file, the comments that turn rules off, and the fixes, on a real bot in a temporary
// folder. The fixes are checked against ForgeScript itself: --fix must leave what ForgeScript's
// compiler makes of the code unchanged, and --fix-brackets must make ForgeScript print the text as
// it was written.
const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { spawnSync } = require("node:child_process")
const forgescript = require("@tryforge/forgescript")
const { Project, ConfigError, fixText, FunctionTable, extractCode } = require("..")

const CLI = path.join(__dirname, "..", "dist", "cli.js")
const MODULES = path.join(__dirname, "..", "node_modules")

/** A bot in a temporary folder: files by relative path, with this package's node_modules. */
function bot(files) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reforgiparse-"))
    fs.symlinkSync(MODULES, path.join(dir, "node_modules"), "dir")
    const all = { "package.json": JSON.stringify({ name: "bot", dependencies: { "@tryforge/forgescript": "2.8.0" } }), ...files }
    for (const [name, text] of Object.entries(all)) {
        fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true })
        fs.writeFileSync(path.join(dir, name), text)
    }
    return dir
}
const command = (code) => `module.exports = { name: "x", type: "messageCreate", code: ${JSON.stringify(code)} }\n`
const rules = (dir, options) => Project.load(dir, options).check().map((d) => `${d.file}:${d.line} ${d.severity} ${d.rule}`)

test("config: levels, off, known names, exclude, and the package.json key", () => {
    const dir = bot({
        "commands/a.js": command("$pingms $makeAtRuntime[1] $AUTHORID"),
        "tests/b.js": command("$get[a"),
        "reforgiparse.config.json": JSON.stringify({ rules: { "glued-name": "error", "function-case": "off" }, known: ["$makeAtRuntime"], exclude: ["tests"] }),
    })
    assert.deepEqual(rules(dir), ["commands/a.js:1 error glued-name"])

    fs.rmSync(path.join(dir, "reforgiparse.config.json"))
    const pj = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"))
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ ...pj, reforgiparse: { rules: { "glued-name": "off" }, include: ["commands"] } }))
    assert.deepEqual(rules(dir), ["commands/a.js:1 warning unknown-function", "commands/a.js:1 info function-case"])
})

test("config: a typo or a wrong value is an error, never a silent default", () => {
    const dir = bot({ "commands/a.js": command("ok") })
    for (const [config, message] of [
        [{ rules: { "glued-names": "off" } }, /"glued-names", which is not a rule \(did you mean "glued-name"\?\)/],
        [{ rules: { "glued-name": "of" } }, /must be "error", "warning", "info" or "off", not "of"/],
        [{ exclud: ["tests"] }, /unknown option "exclud"/],
    ]) {
        fs.writeFileSync(path.join(dir, "reforgiparse.config.json"), JSON.stringify(config))
        assert.throws(() => Project.load(dir), (e) => e instanceof ConfigError && message.test(e.message), JSON.stringify(config))
    }
    fs.writeFileSync(path.join(dir, "reforgiparse.config.json"), "{ not json")
    assert.throws(() => Project.load(dir), /is not valid JSON/)
    const cli = spawnSync(process.execPath, [CLI], { cwd: dir, encoding: "utf8" })
    assert.equal(cli.status, 2)
    assert.match(cli.stderr, /^config: .*is not valid JSON/)
})

test("directives in $c[...] and in JavaScript comments, ForgeLint's too", () => {
    const dir = bot({
        "commands/a.js": [
            "module.exports = { name: 'x', type: 'messageCreate', code: `$c[reforgiparse-disable-next-line glued-name]",
            "$pingms",
            "$pingms $c[reforgiparse-disable-line]",
            "$pingms $c[forgelint-disable-line glued-name]",
            "$c[reforgiparse-disable unknown-function]",
            "$nope1 $pingms",
            "$c[reforgiparse-enable unknown-function]",
            "$nope2 $c[reforgiparse-disable-line glued-nme]` }",
            "// reforgiparse-disable-next-line",
            "module.exports.b = { name: 'y', type: 'messageCreate', code: '$nope3' }",
            "module.exports.c = { name: 'z', type: 'messageCreate', code: '$nope4' }",
        ].join("\n"),
    })
    assert.deepEqual(rules(dir), [
        "commands/a.js:6 warning glued-name",
        "commands/a.js:8 warning unknown-function",
        "commands/a.js:8 warning unknown-rule",
        "commands/a.js:11 warning unknown-function",
    ])
    assert.match(Project.load(dir).check().find((d) => d.rule === "unknown-rule").message, /"glued-nme", which is not a rule, so it turns nothing off\. Did you mean "glued-name"\?/)
})

/** What ForgeScript's own compiler makes of code: functions by name, fields and errors. */
function compiled(code) {
    const field = (f) => ("op" in f ? [f.op, field(f.lhs), f.rhs && field(f.rhs)] : [f.value, f.functions.map(call)])
    const call = (c) => [c.name, c.index, c.negated, c.silent, c.count ?? null, c.fields ? c.fields.map(field) : null]
    try {
        const r = new forgescript.Compiler(undefined, code).compile()
        return [r.code, r.functions.map(call)]
    } catch (e) {
        return ["error", e.message]
    }
}

test("--fix: names in their declared case, and ForgeScript's compiler makes the same of the code", () => {
    forgescript.FunctionManager.loadNative()
    const table = FunctionTable.fromForgeScript(forgescript)
    const before = "module.exports = { code: `$AUTHORID $SendMessage[$channelid;$if[$GET[a]==1;yes;no]] \\\\$PING $c[$Ping]` }"
    const r = fixText(before, table)
    assert.equal(r.text, "module.exports = { code: `$authorID $sendMessage[$channelID;$if[$get[a]==1;yes;no]] \\\\$PING $c[$ping]` }")
    assert.equal(r.fixes.length, 5)
    const [a] = extractCode(before)
    const [b] = extractCode(r.text)
    assert.deepEqual(compiled(b.value), compiled(a.value))
    // A name written with an escape in the file is left alone.
    const escaped = fixText("module.exports = { code: '$\\x50ING' }", table)
    assert.equal(escaped.fixes.length, 0)
    assert.equal(escaped.skipped.length, 1)
})

test("--fix-brackets: ForgeScript then prints the text as written", async () => {
    forgescript.FunctionManager.loadNative()
    const table = FunctionTable.fromForgeScript(forgescript)
    const before = "module.exports = { code: `$let[x;[Docs](https://x.y)]$get[x]` }"
    const r = fixText(before, table, { brackets: true })
    assert.equal(r.text, "module.exports = { code: `$let[x;\\\\[Docs\\\\](https://x.y)]$get[x]` }")
    const { ForgeClient, Compiler, Interpreter } = forgescript
    const out = process.stdout.write
    process.stdout.write = () => true
    const client = new ForgeClient({ intents: ["Guilds"] })
    process.stdout.write = out
    const run = (code) => Interpreter.run({ client, data: Compiler.compile(code), obj: { channel: { id: "1" } }, command: null, doNotSend: true, allowTopLevelReturn: true })
    assert.equal(await run(extractCode(before)[0].value), "(https://x.y)][Docs")
    assert.equal(await run(extractCode(r.text)[0].value), "[Docs](https://x.y)")
    // Without a later ] to close the function, escaping would leave it unclosed: left as it is.
    const stuck = fixText("module.exports = { code: '$let[x;[a]' }", table, { brackets: true })
    assert.equal(stuck.fixes.length, 0)
})

test("the command line writes the fixes and reports them", () => {
    const dir = bot({ "commands/a.js": command("$AUTHORID $description[[a](b)]") })
    const plain = spawnSync(process.execPath, [CLI, "--fix"], { cwd: dir, encoding: "utf8" })
    assert.match(plain.stderr, /^fixed {2}commands\/a\.js:1:\d+ {2}\$AUTHORID → \$authorID$/m)
    assert.match(fs.readFileSync(path.join(dir, "commands/a.js"), "utf8"), /\$authorID \$description\[\[a\]\(b\)\]/)
    assert.match(plain.stdout, /unescaped-bracket/)
    const brackets = spawnSync(process.execPath, [CLI, "--fix-brackets"], { cwd: dir, encoding: "utf8" })
    assert.match(fs.readFileSync(path.join(dir, "commands/a.js"), "utf8"), /\$description\[\\\\\[a\\\\\]\(b\)\]/)
    assert.equal(brackets.status, 0)
    assert.doesNotMatch(brackets.stdout, /unescaped-bracket/)
})

const NESTED = "module.exports = {\n    code: `$let[a;1]\n$if[$get[a]==1;\n$title[One]\n        $sum[1;1]\n          ;\n  $title[Other]\n      ]\nSome text stays\n$sendMessage[$channelID;Hi]`\n}\n"

test("--reindent: lines starting with a function, ; or ] by nesting; text and blank lines left alone", () => {
    forgescript.FunctionManager.loadNative()
    const table = FunctionTable.fromForgeScript(forgescript)
    const two = fixText(NESTED, table, { case: false, reindent: true, indent: 2 })
    assert.equal(two.text, "module.exports = {\n    code: `$let[a;1]\n$if[$get[a]==1;\n  $title[One]\n  $sum[1;1]\n;\n  $title[Other]\n]\nSome text stays\n$sendMessage[$channelID;Hi]`\n}\n")
    assert.equal(two.fixes.length, 4)
    assert.match(fixText(NESTED, table, { case: false, reindent: true, indent: "tab" }).text, /\n\t\$title\[One\]\n\t\$sum\[1;1\]\n;\n/)
    // A line that starts with text keeps its indentation, and so does every line of an argument that
    // has text: that whitespace is sent with the words (as in a poll's list of options).
    const text = "module.exports = { code: `$if[1==1;\n      hello $sum[1;1]\n    $title[x]\n]` }"
    const withText = fixText(text, table, { case: false, reindent: true, indent: 2 })
    assert.equal(withText.text, text)
    assert.match(withText.skipped[0].description, /its argument also has text, so this whitespace is sent with it/)
    // Inside a condition, whitespace is part of what is compared: never moved.
    const condition = "module.exports = { code: `$if[\n      $get[a]==1;yes;no]` }"
    const kept = fixText(condition, table, { case: false, reindent: true, indent: 2 })
    assert.equal(kept.text, condition)
    assert.match(kept.skipped[0].description, /inside a condition, where whitespace is compared/)
    // Opt-in: without it, nothing moves.
    assert.equal(fixText(NESTED, table).text, NESTED)
    // Code that does not compile, and a plain quoted string, are left alone.
    const broken = "module.exports = { code: `$if[1==1;\n      $title[x]\n` }"
    assert.equal(fixText(broken, table, { case: false, reindent: true }).text, broken)
    const quoted = 'module.exports = { code: "$if[1==1;\\n      $title[x]\\n]" }'
    assert.equal(fixText(quoted, table, { case: false, reindent: true }).text, quoted)
})

test("--reindent: ForgeScript's compiler sees the same code apart from indentation, and the interpreter shows why it is opt-in", async () => {
    forgescript.FunctionManager.loadNative()
    const table = FunctionTable.fromForgeScript(forgescript)
    const after = fixText(NESTED, table, { case: false, reindent: true, indent: 2 }).text
    const norm = (x) => JSON.stringify(x).replace(/\\n[ \\t]*/g, "\\n")
    assert.equal(norm(compiled(extractCode(after)[0].value)), norm(compiled(extractCode(NESTED)[0].value)))
    assert.notEqual(JSON.stringify(compiled(extractCode(after)[0].value)), JSON.stringify(compiled(extractCode(NESTED)[0].value)))

    const { ForgeClient, Compiler, Interpreter } = forgescript
    const out = process.stdout.write
    process.stdout.write = () => true
    const client = new ForgeClient({ intents: ["Guilds"] })
    process.stdout.write = out
    const run = (code) => Interpreter.run({ client, data: Compiler.compile(code), obj: { channel: { id: "1" } }, command: null, doNotSend: true, allowTopLevelReturn: true })
    const file = "module.exports = { code: `$if[1==1;\n$sum[1;1]\n]` }"
    const moved = fixText(file, table, { case: false, reindent: true, indent: 4 }).text
    assert.equal(await run(extractCode(file)[0].value), "\n2\n")
    assert.equal(await run(extractCode(moved)[0].value), "\n    2\n", "the indentation is part of what $if returns")
})

test("--reindent on the command line, and the indent option", () => {
    const dir = bot({ "commands/a.js": NESTED, "reforgiparse.config.json": JSON.stringify({ indent: 2 }) })
    const plain = spawnSync(process.execPath, [CLI], { cwd: dir, encoding: "utf8" })
    assert.equal(fs.readFileSync(path.join(dir, "commands/a.js"), "utf8"), NESTED, "not without --reindent")
    assert.equal(plain.status, 0)
    const r = spawnSync(process.execPath, [CLI, "--reindent"], { cwd: dir, encoding: "utf8" })
    assert.match(r.stderr, /^fixed {2}commands\/a\.js:4:1 {2}indent "" → " {2}"$/m)
    assert.match(fs.readFileSync(path.join(dir, "commands/a.js"), "utf8"), /\n {2}\$title\[One\]\n {2}\$sum\[1;1\]\n;\n/)
    fs.writeFileSync(path.join(dir, "reforgiparse.config.json"), JSON.stringify({ indent: "two" }))
    assert.throws(() => Project.load(dir), /"indent" must be a number of spaces from 1 to 8, or "tab", not "two"/)
})
