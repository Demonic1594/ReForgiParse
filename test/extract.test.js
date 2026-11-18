"use strict"
// extractCode must read a string exactly as JavaScript does: Node evaluates the same literal and the
// values must be equal. Every character must map back to the place in the file it came from.
const { test } = require("node:test")
const assert = require("node:assert/strict")
const vm = require("node:vm")
const { cook, extractCode, DYNAMIC, lineColumn, fileOffset } = require("..")

function rng(seed) {
    let a = seed >>> 0
    return () => {
        a = (a + 0x6d2b79f5) >>> 0
        let t = a
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

const PIECES = ["a", "$ping", "[", "]", ";", " ", "😀", "é", "\\\\", "\\n", "\\t", "\\r", "\\b", "\\f", "\\v", "\\0", "\\x41", "\\u00e9", "\\u{1F600}", "\\$", "\\[", "\\;", "\\]", "\\'", '\\"', "\\`", "\\q", "\\\n", "\\\r\n", "\\u2028"]

test("string and template literals are read as JavaScript reads them", () => {
    const r = rng(7)
    let n = 0
    for (let i = 0; i < 5000; i++) {
        let body = ""
        const len = Math.floor(r() * 12)
        for (let j = 0; j < len; j++) body += PIECES[Math.floor(r() * PIECES.length)]
        for (const q of ['"', "'", "`"]) {
            let text = body
            if (q !== "`") text = text.replace(/\\\r\n/g, "\\\n")
            if (q === "`" && r() < 0.3) text += "\r\nline\rcr"
            const literal = q + text.split(q).join("\\" + q) + q
            let expected
            try {
                expected = vm.runInNewContext(literal)
            } catch {
                continue
            }
            const got = cook(literal, 0)
            assert.equal(got.error, null, literal)
            assert.equal(got.end, literal.length, literal)
            assert.equal(got.value, expected, literal)
            assert.equal(got.offsets.length, got.value.length)
            for (let k = 1; k < got.offsets.length; k++) assert.ok(got.offsets[k] >= got.offsets[k - 1], "offsets never go back")
            n++
        }
    }
    assert.ok(n > 12000, `${n} literals compared`)
})

test("only code: values are found; comments, other strings and other properties are skipped", () => {
    const file = [
        'const s = "code: \\"$notThis\\""',
        "// code: `$notThis`",
        "/* code: '$notThis' */",
        "const o = { name: 'x', mycode: '$notThis', code: `$ping ${1 + 1} $get[a]` }",
        'module.exports = { code: "$sendMessage[$channelID;hi]", data: { code: \'$inner\' } }',
    ].join("\n")
    const found = extractCode(file)
    assert.deepEqual(found.map((s) => s.value), [`$ping ${DYNAMIC} $get[a]`, "$sendMessage[$channelID;hi]", "$inner"])
    assert.equal(found[0].dynamic, true)
    assert.deepEqual(extractCode(file, ["code", "mycode"]).map((s) => s.property), ["mycode", "code", "code", "code"])
})

test("each character maps back to its line and column in the file", () => {
    const file = 'module.exports = {\n    code: `first\n  \\\\$get[a] $ping`\n}\n'
    const [src] = extractCode(file)
    const at = (needle) => lineColumn(file, fileOffset(src, src.value.indexOf(needle)))
    assert.deepEqual(at("first"), { line: 2, column: 12 })
    assert.deepEqual(at("$ping"), { line: 3, column: 13 })
    // `\\$get` in the file is `\$get` for ForgeScript: the backslash maps to the first of the two.
    assert.deepEqual(at("\\$get"), { line: 3, column: 3 })
})

test("an unterminated string is reported, not read past its line", () => {
    const [src] = extractCode('const c = { code: "$ping\n}')
    assert.equal(src.error, "unterminated string")
})
