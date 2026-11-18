"use strict"
// What ForgeScript's compiler does not give, checked against the source and against strict mode:
// every position points at the right character, recovering never changes a tree that has no
// errors, its first error is the one ForgeScript throws, and nameIssues agrees with what runs.
const { test } = require("node:test")
const assert = require("node:assert/strict")
const forgescript = require("@tryforge/forgescript")
const { FunctionTable, parse, walk, nameIssues, render, CompileError } = require("..")
const { corpus } = require("./support/corpus")
const { fuzz } = require("./support/fuzz")

forgescript.FunctionManager.loadNative()
const table = FunctionTable.fromForgeScript(forgescript)
const inputs = [...corpus(), ...fuzz(table, Number(process.env.FUZZ_RUNS || 20000), Number(process.env.FUZZ_SEED || 1594) + 1)]

function strict(code) {
    try {
        return { result: parse(code, table) }
    } catch (e) {
        if (!(e instanceof CompileError)) throw e
        return { error: e }
    }
}

function checkField(code, f, call, endsAtOperator = false) {
    assert.ok(f.start >= (call.open ?? 0) && f.end >= f.start && f.end <= code.length, "field inside the call")
    if (!endsAtOperator) assert.ok(f.end === code.length || code[f.end] === ";" || code[f.end] === "]", `field ends at ; or ] (got ${JSON.stringify(code[f.end])})`)
    for (const inner of f.functions) assert.ok(inner.start >= f.start && inner.end <= f.end, "inner call inside its field")
}

function checkCall(code, c) {
    const head = code.slice(c.start, c.nameStart)
    assert.match(head, /^\$!?#?(@\[.*?\])?$/s, `prefix of ${c.written}`)
    assert.equal(code.slice(c.nameStart, c.nameEnd), c.written.slice(1), "name position")
    assert.equal(c.written.toLowerCase() === c.name.toLowerCase() || (c.fn.aliases ?? []).some((a) => a.toLowerCase() === c.written.toLowerCase()), true, "written name is the name or an alias")
    if (c.open !== null) assert.equal(code[c.open], "[", "open bracket")
    if (c.open !== null) assert.equal(c.open, c.nameEnd, "[ right after the name")
    if (c.close !== null) assert.equal(code[c.close], "]", "close bracket")
    for (const s of c.separators) assert.equal(code[s], ";", "separator")
    assert.ok(c.end >= c.nameEnd && c.end <= code.length, "end")
    for (const f of c.fields ?? []) {
        if (f.kind === "condition") {
            checkField(code, f.lhs, c, !!f.rhs)
            if (f.rhs) {
                assert.equal(f.lhs.end, f.opStart, "the left side ends at the operator")
                assert.equal(f.rhs.start, f.opStart + f.op.length, "the right side starts after it")
                checkField(code, f.rhs, c)
                assert.equal(code.slice(f.opStart, f.opStart + f.op.length), f.op, "operator position")
            }
        } else checkField(code, f, c)
    }
}

test("every call, bracket, separator, field and operator position points at the right character", () => {
    let calls = 0
    for (const code of inputs) {
        const res = parse(code, table, { recover: true })
        for (const c of walk(res.functions)) {
            calls++
            checkCall(code, c)
        }
    }
    assert.ok(calls > 50000, `${calls} calls checked`)
})

test("recovering gives the strict tree when there is no error, and ForgeScript's error first when there is", () => {
    let withErrors = 0
    for (const code of inputs) {
        const s = strict(code)
        const r = parse(code, table, { recover: true })
        if (s.result) {
            assert.deepEqual(r.errors, [], JSON.stringify(code))
            assert.deepEqual(r, s.result, JSON.stringify(code))
        } else {
            withErrors++
            assert.ok(r.errors.length >= 1, JSON.stringify(code))
            const first = r.errors[0]
            assert.deepEqual([first.message, first.line, first.column, first.offset, first.kind], [s.error.message, s.error.line, s.error.column, s.error.offset, s.error.kind], JSON.stringify(code))
        }
    }
    assert.ok(withErrors > 1000)
})

test("recovering reports every error, not only the first", () => {
    const r = parse("$sendMessage $if[1==1;a;b;c] $get[x", table, { recover: true })
    assert.deepEqual(r.errors.map((e) => e.kind), ["requires-brackets", "too-many-args", "missing-closure"])
    assert.deepEqual(r.functions.map((c) => c.name), ["$sendMessage", "$if", "$get"])
    assert.equal(r.functions[1].fields.length, 4, "the extra argument is kept")
})

test("render fills placeholders in order and drops backslashes before them, as ForgeScript does", () => {
    const r = parse("a $ping b \\\\$ping c", table)
    assert.equal(render(r.code, ["1", "2"]), "a 1 b 2 c")
    assert.equal(render(r.code, []), "a  b  c")
})

test("nameIssues: glued and unknown names, escaped ones skipped, agreeing with what runs", () => {
    const issues = nameIssues("$pingms $notAFunction \\$alsoNot $authorID $AUTHORIDx", table)
    assert.deepEqual(
        issues.map((i) => [i.kind, i.written, i.runs, i.rest]),
        [
            ["glued", "$pingms", "$ping", "ms"],
            ["unknown", "$notAFunction", null, ""],
            ["glued", "$AUTHORIDx", "$authorID", "x"],
        ],
    )
    // Every glued issue is a call that really runs, and every unknown one is text in the template.
    for (const code of inputs.slice(0, 5000)) {
        const res = parse(code, table, { recover: true })
        const starts = new Set(Array.from(walk(res.functions), (c) => c.start))
        for (const i of nameIssues(code, table, res)) assert.equal(starts.has(i.start), i.kind === "glued", JSON.stringify(code))
    }
})
