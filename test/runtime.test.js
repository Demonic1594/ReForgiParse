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

test("invalid-argument in functions that read their own arguments, and for emoji and sticker IDs: the error the message quotes", async () => {
    for (const code of ["$loop[abc;x]", "$loop[2;x;i;maybe]", "$userCooldown[$authorID;1.5h]", "$emojiName[😀]", "$emojiName[smile]", "$stickerName[cool]", "$emojiGuildID[smile]", "$addButton[id;label;0]", "$addButton[id;label;99]"]) await stopsAsQuoted(code, "invalid-argument")
    // A function that takes no brackets but needs an argument.
    if (table.get("$entitlementConsume")?.args === null) await stopsAsQuoted("$entitlementConsume", "too-few-arguments")
    // A BigInt that JavaScript cannot read: ForgeScript's resolver throws, and that error is logged.
    await stopsAsQuoted("$bigintSum[1;1.5]", "invalid-argument")
    // A number is an enum value only where the enum has it: ButtonStyle starts at 1.
    assert.equal((await run("$addButton[id;label;1]")).error, null)
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

test("invalid-argument from a function's own work: ForgeScript logs the error the message quotes", async () => {
    for (const code of ["$arrayCreate[a;-1]", "$arrayCreate[a;1.5]", "$base[10;99]", "$decodeURI[%E0%A4%A]", "$decodeURIComponent[%]", "$repeat[x;-1]", "$repeat[x;Infinity]", "$replaceRegex[abc;(;g;x]", "$replaceRegex[abc;a;zz;x]"]) await stopsAsQuoted(code, "invalid-argument")
    // $setTimezone only stores the zone: the next function that uses it fails, with the error quoted.
    const f = finding("$setTimezone[Bad/Zone]", "invalid-argument")
    const quoted = /with "([^"]+)"/.exec(f.message)[1]
    assert.equal((await run("$setTimezone[Bad/Zone]")).error, null)
    const later = await run("$setTimezone[Bad/Zone]$parseDate[1;Locale]")
    assert.equal(later.output, null)
    assert.ok(later.error?.includes(quoted), later.error)
})

test("$callFunction and $callLocalFunction: ForgeScript stops with the error the message quotes", async () => {
    for (const code of ["$callLocalFunction[nope]", "$callLocalFunction[add;1;2]$localFunction[add;x;a;b]", "$localFunction[add;$sum[$env[a];$env[b]];a;b]$callLocalFunction[add;1]", "$callFunction[nope]"]) await stopsAsQuoted(code, "invalid-argument")
    // A custom function the bot has: too few arguments.
    quiet(() => client.functions.add({ name: "greet", params: ["who"], code: "hi $env[who]" }))
    const custom = new FunctionTable([...table.byKey.values(), { name: "$greet", aliases: null, args: { required: true, fields: [{}] }, params: [{ name: "who", required: true }], unwrap: true, package: "custom" }])
    const f = checkCode("$callFunction[greet]", custom, { values }).find((x) => x.rule === "invalid-argument")
    const quoted = /ForgeScript stops the command: "([^"]+)"/.exec(f.message)[1]
    const r = await run("$callFunction[greet]")
    assert.equal(r.output, null)
    assert.ok(r.error?.includes(quoted), r.error)
    assert.equal((await run("$callFunction[greet;you]")).output, "hi you")
})

test("misplaced-branch and $ifx without $if: what ForgeScript does", async () => {
    const quoted = /fails with "([^"]+)"/.exec(finding("$ifx[$else[b]]", "misplaced-statement").message)[1]
    const crash = await run("$ifx[$else[b]]")
    assert.equal(crash.output, null)
    assert.ok(crash.error?.includes(quoted), crash.error)
    // Runs every time, outside its block.
    assert.equal((await run("$else[e]after")).output, "eafter")
    assert.equal((await run("$case[a;x]after")).output, "xafter")
    // Never runs, inside it.
    assert.equal((await run("$ifx[$if[1==2;a]$if[1==1;b]]after")).output, "after")
    assert.equal((await run("$ifx[$if[1==2;a]$else[b]$else[c]]after")).output, "bafter")
    assert.equal((await run("$ifx[$if[1==2;a]$let[z;1]]got=$get[z]")).output, "got=")
    assert.equal((await run("$switch[a;$case[a;x]$case[a;y]]")).output, "x")
    assert.equal((await run("$switch[a;$let[z;1]$case[a;x]]got=$get[z]")).output, "xgot=")
})

test("missing-context: without an interaction, its state or message words, each such function gives nothing (false for $is...)", async () => {
    const fns = table.functions.filter((f) => f.context && f.package === "@tryforge/forgescript")
    assert.ok(fns.length > 70, `${fns.length} functions`)
    for (const fn of fns) {
        // $entitlementConsume takes no brackets but needs an argument, so it never runs (tested elsewhere).
        if (fn.args === null && fn.params?.some((p) => p.required)) continue
        // run() has no interaction, no states and no message words, like a command whose event gives none.
        const args = (fn.params ?? []).filter((p) => p.required).map((p) => (p.type === "Enum" ? (p.enumObject ? Object.keys(p.enumObject).find((k) => Number.isNaN(Number(k))) : p.enum[0]) : p.type === "Number" ? "1" : "x"))
        const code = fn.args?.required || args.length ? `${fn.name}[${args.join(";")}]` : fn.name
        const r = await run(code)
        assert.equal(r.error, null, `${code}: ${r.error}`)
        assert.ok(r.output === "" || r.output === "false", `${code} gives ${JSON.stringify(r.output)}`)
        assert.equal(r.output === "false", /^\$is/.test(fn.name), code)
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

test("condition-value: these conditions are false (or true for !=) whatever the values", async () => {
    for (const code of ["$let[a;1]$if[$get[a] == 1;T;F]", "$let[a;1]$if[$get[a]== 1;T;F]", "$let[a;1]$if[\n$get[a]==1;T;F]", "$if[ true ;T;F]", "$if[\n$isNumber[1]\n;T;F]", "$if[$isNumber[1]==True;T;F]", "$if[abc<5;T;F]", "$if[$isNumber[1]>0;T;F]", "$if[$ping;T;F]"]) {
        finding(code, "condition-value")
        assert.equal((await run(code)).output, "F", code)
    }
    finding("$let[a;1]$if[$get[a]!= 1;T;F]", "condition-value")
    assert.equal((await run("$let[a;1]$if[$get[a]!= 1;T;F]")).output, "T")
    assert.equal((await run("$let[a;1]$if[$get[a]==1;T;F]")).output, "T")
    assert.equal((await run("$let[a;1]$if[$get[a]> 0;T;F]")).output, "T")
    assert.equal((await run("$if[$isNumber[1]==true;T;F]")).output, "T")
    for (const code of ["$let[a;1]$switch[$get[a];$case[ 1 ;T]$case[default;F]]", "$let[a;1]$switch[$get[a] ;$case[1;T]$case[default;F]]"]) {
        finding(code, "condition-value")
        assert.equal((await run(code)).output, "F", code)
    }
    assert.equal((await run("$let[a;1]$switch[$get[a];$case[1;T]$case[default;F]]")).output, "T")
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
