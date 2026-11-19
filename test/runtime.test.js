"use strict"
// Each rule's claim, checked by running its example on ForgeScript's real interpreter (offline: a
// ForgeClient that never logs in, nothing sent). The rule must fire on the example, and ForgeScript
// must do what the rule's message says. Where a message quotes ForgeScript's error, that exact text
// must be what ForgeScript logs.
const { test } = require("node:test")
const assert = require("node:assert/strict")
const forgescript = require("@tryforge/forgescript")
const discord = require("discord.js")
const { ForgeClient, Compiler, Interpreter, Container } = forgescript
const { FunctionTable, checkCode, ValueChecker } = require("..")

const quiet = (fn) => {
    const out = process.stdout.write
    process.stdout.write = () => true
    try {
        return fn()
    } finally {
        process.stdout.write = out
    }
}
// Registers ForgeScript's functions, as a bot does; never logs in.
const client = quiet(() => new ForgeClient({ intents: ["Guilds"] }))
const table = FunctionTable.fromForgeScript(forgescript)
const values = new ValueChecker(forgescript, discord)

/** Runs code as a command would: its output, the error ForgeScript logs, and the first embed's colour. */
async function run(code, { command = false } = {}) {
    const log = []
    const out = process.stdout.write
    const err = process.stderr.write
    process.stdout.write = process.stderr.write = (chunk) => (log.push(String(chunk)), true)
    const container = new Container()
    let output
    try {
        // A command runs without allowTopLevelReturn; only a custom function's body may $return.
        output = await Interpreter.run({ client, data: Compiler.compile(code), obj: { channel: { id: "1" } }, command: null, container, doNotSend: true, allowTopLevelReturn: !command, redirectErrorsToConsole: true })
    } finally {
        process.stdout.write = out
        process.stderr.write = err
    }
    const error = /\[ERROR\][^\n]*/.exec(log.join("").replace(/\x1b\[[0-9;]*m/g, ""))?.[0].replace(/[*`]/g, "") ?? null
    return { output, error, color: container.embeds?.[0]?.data?.color }
}

const finding = (code, rule) => {
    const f = checkCode(code, table, { values }).find((x) => x.rule === rule)
    assert.ok(f, `${rule} expected on ${JSON.stringify(code)}`)
    return f
}

/** A message that says the command stops quotes ForgeScript's error: it must be the one logged. */
async function stopsAsQuoted(code, rule) {
    const f = finding(code, rule)
    const quoted = /ForgeScript stops the command: "([^"]+)"/.exec(f.message)?.[1]
    assert.ok(quoted, `the ${rule} message quotes ForgeScript's error`)
    const r = await run(code)
    assert.equal(r.output, null, `${JSON.stringify(code)} stops the command`)
    assert.ok(r.error?.includes(quoted), `ForgeScript logs ${JSON.stringify(quoted)}; it logged ${JSON.stringify(r.error)}`)
}

test("too-few-arguments: the command stops with the error the message quotes", async () => {
    await stopsAsQuoted("$addField[Coins]", "too-few-arguments")
})

test("invalid-argument: the command stops with the error the message quotes", async () => {
    for (const code of ["$round[abc]", "$wait[1.5h]", "$addButton[id;Hi;primary]", "$ephemeral$addButton[id;Hi;Primary;;yes]"]) await stopsAsQuoted(code, "invalid-argument")
    // And the corrected values run.
    for (const code of ["$round[1.5]", "$wait[1]", "$addActionRow$addButton[id;Hi;Primary]"]) assert.notEqual((await run(code)).output, null, code)
})

test("invalid-argument and too-few-arguments: only the first argument ForgeScript rejects, where it stops", async () => {
    for (const code of ["$addButton[id;label;primary;;yes]", "$addField[Coins;5;maybe;x]"]) {
        const found = checkCode(code, table, { values }).filter((f) => f.rule === "invalid-argument" || f.rule === "too-few-arguments")
        assert.equal(found.length, 1, `one finding for ${code}: ${JSON.stringify(found.map((f) => f.message))}`)
        await stopsAsQuoted(code, found[0].rule)
    }
})

test("incomplete-call and too-few-arguments for functions that read their own arguments: each outcome, on ForgeScript", async () => {
    const { UncheckedArguments } = require("..")
    const { spawnSync } = require("node:child_process")
    for (const [name, entry] of Object.entries(UncheckedArguments)) {
        // Newer functions ($arrayFilter is from ForgeScript 2.7) are checked where they exist.
        if (!table.get(name)) continue
        const code = entry.example
        const found = checkCode(code, table, { values, customFunction: true }).filter((f) => f.rule === "incomplete-call" || f.rule === "too-few-arguments")
        assert.equal(found.length, 1, `${code}: ${JSON.stringify(found)}`)
        if (entry.outcome === "never-ends") {
            // In a process of its own: the command does not finish.
            const script = `const f = require(${JSON.stringify(require.resolve("@tryforge/forgescript"))}); process.stdout.write = () => true; const c = new f.ForgeClient({ intents: ["Guilds"] }); f.Interpreter.run({ client: c, data: f.Compiler.compile(${JSON.stringify(code)}), obj: { channel: { id: "1" } }, command: null, doNotSend: true }).then(() => process.exit(0))`
            const r = spawnSync(process.execPath, ["-e", script], { timeout: 4000 })
            assert.ok(r.error?.code === "ETIMEDOUT" || r.signal, `${code} never ends`)
            continue
        }
        const r = await run(code)
        if (entry.outcome === "stops") await stopsAsQuoted(code, "too-few-arguments")
        else if (entry.outcome === "crashes") {
            assert.equal(r.output, null, `${code} stops`)
            assert.ok(r.error?.includes(`TypeError: Cannot read properties of undefined (reading '${entry.reads}')`), `${code}: ${r.error}`)
            assert.ok(found[0].message.includes(`(reading '${entry.reads}')`))
        } else if (entry.outcome === "always-stops") assert.deepEqual([r.output, r.error], [null, null], `${code} stops, with no error`)
        else assert.ok(r.output !== null && r.error === null, `${code} runs: ${JSON.stringify(r)}`)
    }
})

test("an empty condition: ForgeScript reads it as false", async () => {
    assert.equal((await run("$if[;yes;no]")).output, "no")
    assert.equal((await run("$onlyIf[;stopped]after")).output, null)
    assert.equal((await run("$and[1==1;]")).output, "false")
})

test("misplaced-statement: in a command, ForgeScript stops and sends the error the message quotes; where it is allowed, it does not", async () => {
    for (const code of ["$if[1==1;$break]after", "x$continue", "$scope[$arrayLoad[a;,;1]$arrayForEach[a;v;$break]]after", "$return[r]", "$ifx[$if[1==1;$return[r]]]after", "$while[1==1;$return[r]]after", "$switch[a;$case[a;$break]]after"]) {
        const f = finding(code, "misplaced-statement")
        const quoted = /sends "([^"]+)"/.exec(f.message)[1]
        const r = await run(code, { command: true })
        assert.equal(r.output, null, `${code} stops the command`)
        assert.ok(r.error?.includes(quoted), `${code}: ForgeScript logs ${JSON.stringify(r.error)}`)
    }
    for (const code of ["$loop[2;$break]after", "$loop[2;$scope[$continue]]after", "$try[$break]after", "$loop[1;$return[r]]after", "$async[$break]after"]) {
        assert.ok(!checkCode(code, table, { values }).some((f) => f.rule === "misplaced-statement"), code)
        assert.equal((await run(code, { command: true })).error, null, code)
    }
})

test("color-value: the embed gets the colour the message says", async () => {
    assert.match(finding("$color[blue]", "color-value").message, /#00000b/)
    assert.equal((await run("$color[blue]")).color, 0x00000b)
    assert.match(finding("$color[123456]", "color-value").message, /decimal number 123456/)
    assert.equal((await run("$color[123456]")).color, 123456)
    assert.match(finding("$color[red]", "color-value").message, /the embed gets none/)
    assert.equal((await run("$color[red]")).color, undefined)
    assert.equal((await run("$color[Blue]")).color, discord.Colors.Blue)
})

test("condition-operator: these conditions are false, as the message says", async () => {
    for (const code of ["$if[yes;T;F]", "$if[1==1&&2==2;T;F]", "$if[1==1==1;T;F]"]) {
        finding(code, "condition-operator")
        assert.equal((await run(code)).output, "F", code)
    }
    assert.equal((await run("$if[true;T;F]")).output, "T")
})

test("unescaped-bracket: the first ] closes the function and the rest is printed", async () => {
    finding("$let[x;[Docs](u)]$get[x]", "unescaped-bracket")
    assert.equal((await run("$let[x;[Docs](u)]$get[x]")).output, "(u)][Docs")
    assert.equal((await run("$let[x;\\[Docs\\](u)]$get[x]")).output, "[Docs](u)")
})

test("misplaced-operator: the call is printed as text, or the operator is", async () => {
    finding("[$#!sum[1;2]]", "misplaced-operator")
    assert.equal((await run("[$#!sum[1;2]]")).output, "[$#!sum[1;2]]")
    finding("[$!$sum[1;2]]", "misplaced-operator")
    assert.equal((await run("[$!$sum[1;2]]")).output, "[$!3]")
})

test("unset-variable and wrong-store: $get of what $let never set is empty, and $env has the array", async () => {
    finding("[$get[a]]", "unset-variable")
    assert.equal((await run("[$get[a]]")).output, "[]")
    finding("$arrayCreate[list;3][$get[list]]", "wrong-store")
    const r = await run("$arrayCreate[list;3][$get[list]][$env[list]]")
    assert.match(r.output, /^\[\]\[\[/)
})

test("hidden-output: $! hides the output, as $let did", async () => {
    finding("$let[x;$sum[1;2]]", "hidden-output")
    assert.equal((await run("[$let[x;$sum[1;2]]]")).output, "[]")
    assert.equal((await run("[$!sum[1;2]]")).output, "[]")
})

test("escaped-letter: \\n inside an argument is the letter n", async () => {
    finding("$let[x;a\\nb]$get[x]", "escaped-letter")
    assert.equal((await run("$let[x;a\\nb]$get[x]")).output, "anb")
})

test("stray-bracket: a ] that closes no function is printed", async () => {
    for (const [code, printed] of [["$let[a;1]]", "]"], ["$if[1==1;yes]]", "yes]"]]) {
        finding(code, "stray-bracket")
        assert.equal((await run(code)).output, printed)
    }
    // Balanced brackets in text are printed as written, and are not reported.
    assert.equal((await run("Page [1/3]")).output, "Page [1/3]")
    assert.ok(!checkCode("Page [1/3]", table, { values }).some((f) => f.rule === "stray-bracket"))
})

test("unexpected-brackets, unknown-function, glued-name: what is printed", async () => {
    finding("$ping[x]", "unexpected-brackets")
    assert.match((await run("$ping[x]")).output, /\[x\]$/)
    finding("[$sendMesage[x]]", "unknown-function")
    assert.equal((await run("[$sendMesage[x]]")).output, "[$sendMesage[x]]")
    finding("$pingms", "glued-name")
    assert.match((await run("$pingms")).output, /ms$/)
    assert.doesNotMatch((await run("$pingms")).output, /\$/)
})

test("function-case: the name runs as the declared function", () => {
    finding("$AUTHORID", "function-case")
    assert.equal(Compiler.compile("$AUTHORID").functions[0].data.name, "$authorID")
})

test("compile errors: ForgeScript refuses the code with the message ReForgiParse gives", () => {
    for (const [code, rule] of [["$sendMessage", "missing-brackets"], ["$get[a;b]", "too-many-arguments"], ["$get[a", "unclosed-bracket"]]) {
        const f = finding(code, rule)
        const theirs = (() => {
            try {
                Compiler.compile(code)
            } catch (e) {
                return e.message.replace(/[*`>]/g, "")
            }
        })()
        assert.ok(theirs && theirs.includes(f.message.split(". Usage")[0]), `${code}: ${theirs}`)
    }
})

test("directives: $c[reforgiparse-...] prints nothing, wherever it is", async () => {
    for (const code of ["[$c[reforgiparse-disable-next-line unknown-function]]", "[$c[reforgiparse-disable]]", "a$c[reforgiparse-disable-line glued-name]b"]) {
        assert.equal((await run(code)).output, code.startsWith("[") ? "[]" : "ab", code)
    }
})

test("--reindent leaves conditions alone: whitespace in a condition is compared", async () => {
    assert.equal((await run("$if[1==1;yes;no]")).output, "yes")
    assert.equal((await run("$if[\n      1==1;yes;no]")).output, "no")
})
