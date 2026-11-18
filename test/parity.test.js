"use strict"
// ForgeParse must give what ForgeScript's own compiler gives, for any input: the same tree (names,
// numbering, flags, counts, fields, condition operators, values, raw values), the same template,
// and the same compile error (message, line, column). The compiler is the real one from the
// installed @tryforge/forgescript, given the same function list.
const { test } = require("node:test")
const assert = require("node:assert/strict")
const forgescript = require("@tryforge/forgescript")
const { FunctionTable, parse, CompileError } = require("..")
const { corpus, BUILT_IN } = require("./support/corpus")
const { fuzz } = require("./support/fuzz")

forgescript.FunctionManager.loadNative()
const table = FunctionTable.fromForgeScript(forgescript)
// ForgeScript 2.8.0 records a field's raw text (rawValue); 2.5.0 does not, and then only ForgeParse has it.
const HAS_RAW = new forgescript.Compiler(undefined, "$get[a]").compile().functions[0].fields[0].rawValue !== undefined

/** ForgeScript's result, in a plain shape. */
function oracle(code) {
    try {
        const r = new forgescript.Compiler(undefined, code).compile()
        return { code: r.code, functions: r.functions.map(theirCall) }
    } catch (e) {
        const m = /^> (.*) at \*\*`(\d+)`\*\*:\*\*`(\d+)`\*\*/s.exec(e.message)
        if (!m) throw e
        return { error: m[1].replace(/\*\*`([^`]*)`\*\*/g, "$1"), line: Number(m[2]), column: Number(m[3]) }
    }
}
const theirField = (f) => ("op" in f ? { op: f.op, lhs: theirField(f.lhs), rhs: f.rhs ? theirField(f.rhs) : null } : { value: f.value, raw: f.rawValue, functions: f.functions.map(theirCall) })
const theirCall = (c) => ({ name: c.name, index: c.index, negated: c.negated, silent: c.silent, count: c.count ?? null, fields: c.fields ? c.fields.map(theirField) : null })

/** ForgeParse's result, in the same shape. */
function ours(code) {
    try {
        const r = parse(code, table)
        return { code: r.code, functions: r.functions.map(ourCall) }
    } catch (e) {
        if (!(e instanceof CompileError)) throw e
        return { error: e.message, line: e.line, column: e.column }
    }
}
const ourField = (f) => (f.kind === "condition" ? { op: f.op, lhs: ourField(f.lhs), rhs: f.rhs ? ourField(f.rhs) : null } : { value: f.value, raw: HAS_RAW ? f.raw : undefined, functions: f.functions.map(ourCall) })
const ourCall = (c) => ({ name: c.name, index: c.index, negated: c.negated, silent: c.silent, count: c.count, fields: c.fields ? c.fields.map(ourField) : null })

function check(codes, label) {
    let errors = 0
    for (const code of codes) {
        const want = oracle(code)
        if (want.error) errors++
        assert.deepEqual(ours(code), want, `${label}: ${JSON.stringify(code.slice(0, 300))}`)
    }
    return errors
}

test("every snippet in the corpus parses as ForgeScript compiles it", () => {
    const codes = corpus()
    assert.ok(codes.length >= BUILT_IN.length)
    const errors = check(codes, "corpus")
    console.log(`# corpus: ${codes.length} snippets, ${errors} of them compile errors`)
})

test("random code built from ForgeScript's syntax parses as ForgeScript compiles it", () => {
    const n = Number(process.env.FUZZ_RUNS || 20000)
    const codes = fuzz(table, n, Number(process.env.FUZZ_SEED || 1594))
    const errors = check(codes, "fuzz")
    console.log(`# fuzz: ${codes.length} inputs, ${errors} of them compile errors`)
    assert.ok(errors > n * 0.2 && errors < n * 0.7, `the fuzzer reaches both valid code and errors (${errors} of ${n} are errors)`)
})

test("each compile error ForgeScript has is reached, with the same message and position", () => {
    const cases = {
        "requires-brackets": "a\n  $sendMessage",
        "too-many-args": "$if[1==1;a;b;c]",
        "missing-closure": "$get[a",
    }
    for (const [kind, code] of Object.entries(cases)) {
        const want = oracle(code)
        assert.ok(want.error, kind)
        assert.throws(() => parse(code, table), (e) => e instanceof CompileError && e.kind === kind && e.message === want.error && e.line === want.line && e.column === want.column)
    }
})
