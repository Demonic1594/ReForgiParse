"use strict"
// A whole bot (test/fixtures/bot): its custom functions are known, the code in its files is found
// and checked, every problem is reported once at the right line and column, and the command-line
// tool reports them with the right exit code.
const { test } = require("node:test")
const assert = require("node:assert/strict")
const path = require("node:path")
const { spawnSync } = require("node:child_process")
const { Project, Rules } = require("..")

const BOT = path.join(__dirname, "fixtures", "bot")
const CLI = path.join(__dirname, "..", "dist", "cli.js")

const EXPECTED = [
    ["commands/problems.js", 5, 18, "glued-name"],
    ["commands/problems.js", 6, 1, "missing-brackets"],
    ["commands/problems.js", 7, 23, "too-many-arguments"],
    ["commands/problems.js", 8, 18, "unexpected-brackets"],
    ["commands/problems.js", 9, 41, "missing-brackets"],
    ["commands/problems.js", 9, 41, "glued-name"],
    ["commands/problems.js", 13, 16, "unclosed-bracket"],
    ["commands/problems.js", 16, 11, "unknown-event"],
    ["commands/problems.js", 17, 17, "unexpected-brackets"],
    ["commands/problems.js", 17, 24, "unknown-function"],
    ["commands/problems.js", 17, 51, "missing-brackets"],
    ["commands/problems.js", 17, 59, "too-few-arguments"],
]

test("a bot's problems are found once each, at the right place, and clean code has none", () => {
    const project = Project.load(BOT)
    assert.deepEqual(project.files.map((f) => path.relative(BOT, f)).sort(), ["commands/clean.js", "commands/problems.js", "functions/addOne.js", "functions/greet.js"], "top-level dist/ is skipped")
    assert.deepEqual(project.customFunctions.map((f) => [f.name, f.params.length]), [["addOne", 1], ["greet", 0]])
    const got = project.check()
    assert.deepEqual(got.map((d) => [d.file, d.line, d.column, d.rule]), EXPECTED)
    for (const d of got) assert.equal(d.severity, d.rule === "unknown-event" ? "error" : Rules[d.rule].severity)
    assert.match(got.find((d) => d.rule === "unknown-function").message, /Did you mean \$sendMessage\?/)
    assert.match(got.find((d) => d.rule === "unknown-event").message, /Did you mean "messageCreate"\?/)
    assert.match(got.find((d) => d.rule === "too-few-arguments").message, /"value"\. Usage: \$addField\[name;value;inline\?;index\?\]/)
    assert.deepEqual(project.checkFile("commands/clean.js"), [])
})

const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: BOT, encoding: "utf8" })

test("the command line: text, JSON, errors only, exit codes", () => {
    const text = run()
    assert.equal(text.status, 1)
    assert.match(text.stdout, /^commands\/problems\.js:6:1 {2}error {4}Function \$sendMessage requires brackets/m)
    assert.match(text.stdout, /7 error\(s\), 5 warning\(s\) in 4 file\(s\)/)

    const json = JSON.parse(run("--json").stdout)
    assert.equal(json.errors, 7)
    assert.equal(json.warnings, 5)
    assert.equal(json.diagnostics.length, EXPECTED.length)

    const errorsOnly = run("--no-warnings")
    assert.doesNotMatch(errorsOnly.stdout, /warning {2}/)

    const clean = run("commands/clean.js", "--quiet")
    assert.equal(clean.status, 0)
    assert.equal(clean.stdout, "")

    assert.equal(run("--nope").status, 2)
    assert.equal(run("--help").status, 0)
    assert.match(run("--version").stdout, /^\d+\.\d+\.\d+/)
})

test("an extension without metadata: its NativeFunction files are read without starting it", () => {
    const { readNatives, usage } = require("..")
    const r = readNatives(path.join(__dirname, "fixtures", "native-extension"))
    assert.deepEqual(r.functions.map((f) => [f.name, usage(f), f.unwrap]), [["$fixtureDouble", "$fixtureDouble[number]", true]])
    assert.equal(r.failures.length, 1)
    assert.match(r.failures[0], /broken\.js \(broken on purpose\)/)
})
