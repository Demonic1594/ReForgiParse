"use strict"
// A whole bot (test/fixtures/bot): its custom functions are known, the code in its files is found
// and checked, every problem is reported once at the right line and column, and the command-line
// tool reports them with the right exit code.
const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { spawnSync } = require("node:child_process")
const { Project, Rules } = require("..")

const BOT = path.join(__dirname, "fixtures", "bot")
const FORGESCRIPT = require("@tryforge/forgescript/package.json").version
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const CLI = path.join(__dirname, "..", "dist", "cli.js")

const EXPECTED = [
    ["commands/problems.js", 5, 18, "glued-name"],
    ["commands/problems.js", 6, 1, "missing-brackets"],
    ["commands/problems.js", 7, 23, "too-many-arguments"],
    ["commands/problems.js", 8, 18, "unexpected-brackets"],
    ["commands/problems.js", 9, 41, "missing-brackets"],
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
    assert.match(got.find((d) => d.rule === "too-few-arguments").message, /"value", so ForgeScript stops the command: "Function \$addField is missing argument value"\. Usage: \$addField\[name;value;inline\?;index\?\]/)
    assert.match(got.find((d) => d.line === 9).message, /^\$authorI is not a function here: ForgeScript reads \$author, which requires brackets, so the code does not compile\. Did you mean \$authorID\?/)
    assert.deepEqual(project.checkFile("commands/clean.js"), [])
})

const ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== "FORCE_COLOR" && k !== "NO_COLOR"))
const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: BOT, encoding: "utf8", env: ENV })

test("the command line: text, JSON, errors only, exit codes", () => {
    const text = run()
    assert.equal(text.status, 1)
    assert.match(text.stdout, /^commands\/problems\.js:6:1 +error {4}Function \$sendMessage requires brackets/m)
    assert.match(text.stdout, new RegExp(`^7 errors, 4 warnings in 4 files\nFunctions from @tryforge/forgescript ${escape(FORGESCRIPT)}, custom\\.\n$`, "m"))
    // Severities line up within a file.
    const lines = text.stdout.split("\n").filter((l) => l.startsWith("commands/"))
    assert.equal(new Set(lines.map((l) => l.search(/(error|warning|info) /))).size, 1)

    const json = JSON.parse(run("--json").stdout)
    assert.equal(json.errors, 7)
    assert.equal(json.warnings, 4)
    assert.equal(json.diagnostics.length, EXPECTED.length)
    // Functions, not names: an alias is not counted again.
    assert.equal(json.functions, json.sources.reduce((n, s) => n + s.functions, 0))
    assert.deepEqual(JSON.parse(run("--format=json").stdout), json)

    const errorsOnly = run("--no-warnings")
    assert.doesNotMatch(errorsOnly.stdout, /warning {2}/)

    const clean = run("commands/clean.js", "--quiet")
    assert.equal(clean.status, 0)
    assert.equal(clean.stdout, "")

    const gh = run("--format", "github")
    assert.equal(gh.status, 1)
    assert.match(gh.stdout, /^::error file=commands\/problems\.js,line=6,col=1,endLine=6,endColumn=13,title=reforgiparse missing-brackets::Function \$sendMessage requires brackets/m)
    assert.match(gh.stdout, /^::warning file=commands\/problems\.js,line=5,col=18,/m)

    assert.match(run("--rules").stdout, /^invalid-argument +error +/m)

    assert.equal(run("--nope").status, 2)
    assert.equal(run("--help").status, 0)
    assert.match(run("--version").stdout, /^\d+\.\d+\.\d+/)
})

test("the command line: paths, options and colours", () => {
    // A path that does not exist, or is not code, is a mistake: never a check of nothing.
    for (const [args, message] of [
        [["commands/nope.js"], /^reforgiparse: commands\/nope\.js: no such file or folder\. See reforgiparse --help\.\n$/],
        [["package.json"], /^reforgiparse: package\.json: not a JavaScript or TypeScript file/],
        [["--fixbrackets"], /^reforgiparse: unknown option --fixbrackets \(did you mean --fix-brackets\?\)/],
        [["--format=xml"], /^reforgiparse: --format takes text, json or github, not "xml"/],
        [["--max-warnings", "some"], /^reforgiparse: --max-warnings needs a number of warnings, not "some"/],
        [["commands", path.join("..", "..")], /^reforgiparse: \.\.\/\.\. is not in the bot at \.: check one bot at a time/],
    ]) {
        const r = run(...args)
        assert.equal(r.status, 2, args.join(" "))
        assert.match(r.stderr, message)
    }

    // A folder inside the bot is checked as part of the bot: its custom functions are known.
    const folder = run("commands", "--json")
    const inFolder = JSON.parse(folder.stdout)
    assert.equal(inFolder.root, BOT)
    assert.deepEqual([...new Set(inFolder.diagnostics.map((d) => d.file))], ["commands/problems.js"])
    assert.deepEqual(inFolder.diagnostics.map((d) => [d.file, d.line, d.column, d.rule]), EXPECTED)
    const fromInside = spawnSync(process.execPath, [CLI, "problems.js", "--json"], { cwd: path.join(BOT, "commands"), encoding: "utf8", env: ENV })
    assert.deepEqual(JSON.parse(fromInside.stdout).diagnostics, inFolder.diagnostics)

    // --max-warnings: more warnings than allowed fail the check.
    const clean = (...args) => run("functions", "commands/clean.js", ...args)
    assert.equal(clean().status, 0)
    const warn = path.join(BOT, "commands", "warn.js")
    fs.writeFileSync(warn, 'module.exports = { type: "messageCreate", code: "$pingms" }\n')
    try {
        assert.equal(run("commands/warn.js").status, 0)
        assert.equal(run("commands/warn.js", "--max-warnings", "1").status, 0)
        const over = run("commands/warn.js", "--max-warnings=0")
        assert.equal(over.status, 1)
        assert.match(over.stdout, /^More than --max-warnings 0: exit code 1\.$/m)
        assert.match(run("commands/warn.js", "--max-warnings", "0", "--format", "github").stdout, /^::error title=reforgiparse::1 warning, more than --max-warnings 0$/m)
    } finally {
        fs.rmSync(warn)
    }

    // No colours when not on a terminal, unless FORCE_COLOR asks for them.
    assert.doesNotMatch(run().stdout, /\x1b\[/)
    const forced = spawnSync(process.execPath, [CLI], { cwd: BOT, encoding: "utf8", env: { ...ENV, FORCE_COLOR: "1" } })
    assert.match(forced.stdout, /\x1b\[31m7 errors/)
    assert.match(run("commands/clean.js").stdout, /^No problems in 1 file\n/)
})

test("an extension without metadata: its NativeFunction files are read without starting it", () => {
    const { readNatives, usage } = require("..")
    const r = readNatives(path.join(__dirname, "fixtures", "native-extension"))
    assert.deepEqual(r.functions.map((f) => [f.name, usage(f), f.unwrap]), [["$fixtureDouble", "$fixtureDouble[number]", true]])
    assert.equal(r.failures.length, 1)
    assert.match(r.failures[0], /broken\.js \(broken on purpose\)/)
})

test("an extension with metadata/functions.json: its functions, events and descriptions are loaded", () => {
    const os = require("node:os")
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reforgiparse-meta-"))
    const write = (file, data) => {
        fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
        fs.writeFileSync(path.join(dir, file), typeof data === "string" ? data : JSON.stringify(data))
    }
    write("package.json", { name: "bot", dependencies: { "@tryforge/forgescript": "2.8.0", "fixture-meta": "1.2.3", "fixture-broken": "1.0.0", "left-pad": "1.0.0" }, devDependencies: { reforgiparse: "*" } })
    fs.mkdirSync(path.join(dir, "node_modules", "@tryforge"), { recursive: true })
    fs.symlinkSync(path.join(__dirname, "..", "node_modules", "@tryforge", "forgescript"), path.join(dir, "node_modules", "@tryforge", "forgescript"), "dir")
    write("node_modules/fixture-meta/package.json", { name: "fixture-meta", version: "1.2.3", peerDependencies: { "@tryforge/forgescript": "*" } })
    write("node_modules/fixture-meta/metadata/functions.json", [
        { name: "$metaGreet", description: "Greets someone", brackets: true, unwrap: true, args: [{ name: "who", required: true, type: "String" }], output: ["String"] },
    ])
    write("node_modules/fixture-meta/metadata/events.json", [{ name: "metaEvent" }])
    write("node_modules/fixture-broken/package.json", { name: "fixture-broken", version: "1.0.0", dependencies: { "@tryforge/forgescript": "*" } })
    write("node_modules/fixture-broken/metadata/functions.json", "{ not json")
    // A package that does not use ForgeScript is not read at all, and neither is ReForgiParse itself.
    write("node_modules/left-pad/package.json", { name: "left-pad", version: "1.0.0" })
    fs.symlinkSync(path.join(__dirname, ".."), path.join(dir, "node_modules", "reforgiparse"), "dir")
    const line = 'module.exports = [{ type: "metaEvent", code: "$metaGreet[you] $metaGreet $metaGret[x]" }]'
    write("commands/a.js", `${line}\n`)

    const project = Project.load(dir)
    assert.deepEqual(project.sources.map((s) => [s.name, s.version]), [["fixture-meta", "1.2.3"], ["@tryforge/forgescript", FORGESCRIPT]])
    assert.equal(project.sources[0].functions, 1)
    assert.deepEqual(project.notes.map((n) => n.replace(/\(.*\)/, "(...)")), ["fixture-broken: cannot read metadata/functions.json (...)"])
    const fn = project.table.get("$metaGreet")
    assert.equal(fn.package, "fixture-meta")
    assert.equal(fn.description, "Greets someone")
    assert.deepEqual(fn.output, ["String"])
    assert.deepEqual(project.check().map((d) => [d.rule, d.column]), [["missing-brackets", line.indexOf("$metaGreet $") + 1], ["unknown-function", line.indexOf("$metaGret[") + 1]])
    assert.match(project.check()[1].message, /Did you mean \$metaGreet\?/)
})

test("missing-context: a function that reads what the command's event does not give", () => {
    const os = require("node:os")
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reforgiparse-context-"))
    fs.symlinkSync(path.join(__dirname, "..", "node_modules"), path.join(dir, "node_modules"), "dir")
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ dependencies: { "@tryforge/forgescript": "2.8.0" } }))
    fs.mkdirSync(path.join(dir, "commands"))
    const write = (name, text) => fs.writeFileSync(path.join(dir, "commands", name), text)
    write("message.js", 'module.exports = { name: "a", type: "messageCreate", code: "$option[user] $isButton $newMember[id] $newMessage[id] $message" }\n')
    write("slash.js", 'module.exports = { type: "interactionCreate", code: "$option[user] $isButton $message $oldMessage[id]" }\n')
    write("app.js", 'module.exports = { data: { name: "x" }, code: "$option[user] $defer" }\n')
    write("update.js", 'module.exports = { type: "messageUpdate", code: "$oldMessage[id] $newMessage[id] $message" }\n')
    write("member.js", 'module.exports = { type: "guildMemberAdd", code: "$newMember[id] $oldMessage[id] $defer" }\n')
    const project = Project.load(dir)
    assert.ok(project.eventModel.get("messageCreate").states.has("message"))
    assert.equal(project.eventModel.get("interactionCreate").interaction, true)
    assert.equal(project.eventModel.get("guildMemberAdd").words, false)
    const found = project.check().filter((d) => d.rule === "missing-context").map((d) => `${d.file} ${d.message.split(" ")[0]}`)
    assert.deepEqual(found, ["commands/member.js $oldMessage", "commands/member.js $defer", "commands/message.js $option", "commands/message.js $isButton", "commands/message.js $newMember", "commands/slash.js $message", "commands/slash.js $oldMessage"])
    const message = project.check().filter((d) => d.rule === "missing-context")
    assert.match(message.find((d) => d.message.startsWith("$option")).message, /^\$option reads the interaction, and a messageCreate command has none: it does nothing and gives nothing here$/)
    assert.match(message.find((d) => d.message.startsWith("$isButton")).message, /gives false here$/)
    assert.match(message.find((d) => d.message.startsWith("$newMember")).message, /^\$newMember reads the event's member state, which messageCreate does not give: it always gives nothing here$/)
    assert.match(message.find((d) => d.message.startsWith("$message")).message, /^\$message reads the words of a message command, and an interactionCreate command has none: it always gives nothing here$/)
})
