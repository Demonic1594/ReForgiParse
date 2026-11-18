"use strict"
// Random ForgeScript-shaped code: function names from the table (every kind: no brackets, optional,
// required, conditions, rest arguments, aliases), in random case, with !, # and @[...], glued to
// letters, and the syntax characters, operators, escapes, newlines and non-BMP characters between
// them. Seeded, so a failure can be replayed with FUZZ_SEED.

function rng(seed) {
    // mulberry32
    let a = seed >>> 0
    return () => {
        a = (a + 0x6d2b79f5) >>> 0
        let t = a
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

function fuzz(table, n, seed) {
    const r = rng(seed)
    const pick = (xs) => xs[Math.floor(r() * xs.length)]
    const fns = Array.from(new Set(table.byKey.values()))
    const kinds = {
        none: fns.filter((f) => f.args === null),
        optional: fns.filter((f) => f.args && !f.args.required),
        required: fns.filter((f) => f.args?.required && !f.args.fields.some((x) => x.condition || x.rest)),
        condition: fns.filter((f) => f.args?.fields.some((x) => x.condition)),
        rest: fns.filter((f) => f.args?.fields.some((x) => x.rest)),
        aliased: fns.filter((f) => f.aliases?.length),
    }
    const groups = Object.values(kinds).filter((g) => g.length)
    const cased = (s) => {
        const k = r()
        if (k < 0.6) return s
        if (k < 0.8) return s.toUpperCase()
        return Array.from(s, (c) => (r() < 0.5 ? c.toUpperCase() : c.toLowerCase())).join("")
    }
    const name = () => {
        const f = pick(pick(groups))
        const n = f.aliases?.length && r() < 0.3 ? pick(f.aliases) : f.name
        let out = "$"
        if (r() < 0.1) out += "!"
        if (r() < 0.1) out += "#"
        if (r() < 0.08) out += `@[${pick(["", "1", "a;b", "x]", "$ping"])}]`
        out += cased(n.replace(/^\$/, ""))
        if (r() < 0.08) out += pick(["ms", "x", "ID", "_1", "s"])
        return out
    }
    const atoms = [
        "[", "]", ";", "[", "]", ";", "\\", "\\\\", "\\;", "\\]", "\\[", "\\$",
        "==", "!=", "<=", ">=", "<", ">", "=", "!", "$", "$!", "$#", "$@[",
        "a", "text", " ", "1", "-5", "0.5", "\n", "\r\n", "😀", "é", "`", "${x}",
        "[SYSTEM_FUNCTION(0)]", "\\[SYSTEM_FUNCTION(1)]",
    ]
    const out = []
    for (let i = 0; i < n; i++) {
        let code = ""
        const len = 1 + Math.floor(r() * 30)
        for (let j = 0; j < len; j++) {
            const k = r()
            // An escaped name: `\$ping` is text, and the call after it must still be found.
            code += k < 0.05 ? "\\" + name() : k < 0.38 ? name() : pick(atoms)
        }
        out.push(code)
    }
    return out
}

module.exports = { fuzz }
