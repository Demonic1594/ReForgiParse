"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.nameIssues = nameIssues;
// SPDX-License-Identifier: LGPL-3.0-or-later
const parser_1 = require("./parser");
// A name starts with a letter or `_`: `$5` is a price, not a misspelt function.
const TOKEN = /\$(?:!)?(?:#)?(?:@\[.*?\])?([A-Za-z_][A-Za-z0-9_]*)/g;
/**
 * The `$words` ForgeScript does not treat as written. It uses the compiler's own matching, so it
 * agrees with what runs; escaped `\$words` are skipped.
 */
function nameIssues(code, table, result) {
    const res = result ?? (0, parser_1.parse)(code, table, { recover: true });
    const calls = new Map(Array.from((0, parser_1.walk)(res.functions), (c) => [c.start, c]));
    const out = [];
    for (const m of code.matchAll(TOKEN)) {
        const start = m.index;
        let slashes = 0;
        for (let k = start - 1; k >= 0 && code[k] === "\\"; k--)
            slashes++;
        if (slashes % 2)
            continue;
        const end = start + m[0].length;
        const call = calls.get(start);
        if (!call)
            out.push({ kind: "unknown", start, end, written: `$${m[1]}`, runs: null, rest: "" });
        else if (call.nameEnd < end)
            out.push({ kind: "glued", start, end, written: `$${m[1]}`, runs: call.name, rest: code.slice(call.nameEnd, end) });
    }
    return out;
}
//# sourceMappingURL=names.js.map