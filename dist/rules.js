"use strict";
// SPDX-License-Identifier: LGPL-3.0-or-later
//
// Problems in one string of ForgeScript code, found on the parse tree. Every rule says what
// ForgeScript does with the code, so the message is a fact about the bot, not a style opinion.
Object.defineProperty(exports, "__esModule", { value: true });
exports.Rules = void 0;
exports.checkCode = checkCode;
exports.suggest = suggest;
const names_1 = require("./names");
const parser_1 = require("./parser");
const table_1 = require("./table");
/** What each rule finds, and its severity. */
exports.Rules = {
    "missing-brackets": { severity: "error", description: "A function that needs brackets has none. ForgeScript refuses to compile the code." },
    "too-many-arguments": { severity: "error", description: "More arguments than the function takes. ForgeScript refuses to compile the code." },
    "unclosed-bracket": { severity: "error", description: "A `[` that is never closed. ForgeScript refuses to compile the code." },
    "too-few-arguments": { severity: "error", description: "A required argument is missing. The command stops with an error when it gets there." },
    "unexpected-brackets": { severity: "warning", description: "Brackets after a function that takes no arguments: they and their text are printed." },
    "unknown-function": { severity: "warning", description: "A `$name` that is no function here, so it is printed as text." },
    "glued-name": { severity: "warning", description: "A `$name` whose start is another function: that one runs, and the rest is printed." },
};
const COMPILE_RULE = {
    "requires-brackets": "missing-brackets",
    "too-many-args": "too-many-arguments",
    "missing-closure": "unclosed-bracket",
};
/** Every problem in one string of code. */
function checkCode(code, table, result = (0, parser_1.parse)(code, table, { recover: true })) {
    const out = [];
    const add = (rule, message, start, end) => out.push({ rule, severity: exports.Rules[rule].severity, message, start, end: Math.max(end, start) });
    for (const e of result.errors) {
        const fn = table.get(e.fn);
        const hint = fn && fn.params ? `. Usage: ${(0, table_1.usage)(fn)}` : "";
        add(COMPILE_RULE[e.kind], `${e.message}${hint}`, e.start, e.end);
    }
    for (const call of (0, parser_1.walk)(result.functions)) {
        const fn = call.fn;
        if (fn.args === null && code[call.nameEnd] === "[") {
            add("unexpected-brackets", `${call.name} takes no arguments, so "[" and what follows it are printed as text`, call.nameEnd, call.nameEnd + 1);
        }
        // Only where ForgeScript resolves the arguments itself: functions like $if read their own fields.
        if (call.fields && fn.params && fn.unwrap) {
            const missing = missingArgument(fn, call.fields);
            if (missing)
                add("too-few-arguments", `${call.name} is missing its argument "${missing}". Usage: ${(0, table_1.usage)(fn)}`, call.start, call.close !== null ? call.close + 1 : call.end);
        }
    }
    for (const issue of (0, names_1.nameIssues)(code, table, result)) {
        const guess = suggest(issue.written, table);
        if (issue.kind === "unknown") {
            add("unknown-function", `${issue.written} is not a function here, so ForgeScript prints it as text${guess ? `. Did you mean ${guess}?` : ""}`, issue.start, issue.end);
        }
        else {
            const other = guess && guess.toLowerCase() !== issue.runs.toLowerCase() ? ` Did you mean ${guess}?` : "";
            add("glued-name", `${issue.written} runs ${issue.runs} and prints "${issue.rest}" after it.${other}`, issue.start, issue.end);
        }
    }
    return out.sort((a, b) => a.start - b.start || a.end - b.end);
}
/** The first required argument the call does not have, or `null`. */
function missingArgument(fn, fields) {
    const params = fn.params ?? [];
    for (let i = 0; i < params.length; i++) {
        const p = params[i];
        if (p.required && i >= fields.length)
            return p.name;
    }
    return null;
}
/** The closest function name to a mistyped one, or `null` when none is close enough. */
function suggest(written, table) {
    const word = written.replace(/^\$/, "").toLowerCase();
    const limit = word.length <= 4 ? 1 : word.length <= 8 ? 2 : 3;
    let best = null;
    let bestDistance = Infinity;
    for (const [key, fn] of table.byKey) {
        const name = key.slice(1);
        if (Math.abs(name.length - word.length) > limit)
            continue;
        const d = distance(word, name, limit);
        if (d < bestDistance || (d === bestDistance && best !== null && fn.name.length < best.length)) {
            bestDistance = d;
            best = key === fn.name.toLowerCase() ? fn.name : `$${matchCase(key.slice(1), fn)}`;
        }
    }
    return bestDistance <= limit && bestDistance > 0 ? best : null;
}
/** An alias in the case its function declares it. */
function matchCase(alias, fn) {
    return (fn.aliases ?? []).find((a) => a.replace(/^\$/, "").toLowerCase() === alias)?.replace(/^\$/, "") ?? alias;
}
/** Edit distance with transpositions, giving up above `limit`. */
function distance(a, b, limit) {
    if (a === b)
        return 0;
    let prev2 = [];
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
        const cur = [i];
        let rowMin = i;
        for (let j = 1; j <= b.length; j++) {
            let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
                v = Math.min(v, prev2[j - 2] + 1);
            cur.push(v);
            rowMin = Math.min(rowMin, v);
        }
        if (rowMin > limit)
            return Infinity;
        prev2 = prev;
        prev = cur;
    }
    return prev[b.length];
}
//# sourceMappingURL=rules.js.map