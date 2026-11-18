"use strict";
// SPDX-License-Identifier: LGPL-3.0-or-later
//
// Problems in one string of ForgeScript code, found on the parse tree. Every rule states what
// ForgeScript does with the code, checked in its source (2.8.0) or by running its own resolvers,
// so a message is a fact about the bot, not a style opinion.
Object.defineProperty(exports, "__esModule", { value: true });
exports.Rules = void 0;
exports.checkCode = checkCode;
exports.suggest = suggest;
exports.distance = distance;
const names_1 = require("./names");
const parser_1 = require("./parser");
const table_1 = require("./table");
/** What each rule finds, and its severity. */
exports.Rules = {
    "missing-brackets": { severity: "error", description: "A function that needs brackets has none. ForgeScript refuses to compile the code." },
    "too-many-arguments": { severity: "error", description: "More arguments than the function takes. ForgeScript refuses to compile the code." },
    "unclosed-bracket": { severity: "error", description: "A `[` that is never closed. ForgeScript refuses to compile the code." },
    "too-few-arguments": { severity: "error", description: "A required argument is missing: the command stops (\"Function $x is missing argument y\")." },
    "invalid-argument": { severity: "error", description: "An argument ForgeScript cannot read as its type: the command stops (\"Given value ... is not of type ...\")." },
    "unexpected-brackets": { severity: "warning", description: "Brackets after a function that takes no arguments: they and their text are printed." },
    "unknown-function": { severity: "warning", description: "A `$name` that is no function here, so it is printed as text." },
    "glued-name": { severity: "warning", description: "A `$name` whose start is another function: that one runs, and the rest is printed." },
    "misplaced-operator": { severity: "warning", description: "`!`, `#` or `@[...]` in the wrong order, or before another `$`: the call is printed as text." },
    "condition-operator": { severity: "warning", description: "A condition ForgeScript reads differently: a second operator, `&&` or `||`, or no operator at all." },
    "unescaped-bracket": { severity: "warning", description: "A `]` meant for a `[` in the text closes the function instead; the rest is printed." },
    "color-value": { severity: "warning", description: "A colour ForgeScript reads differently from what was meant (`blue`, `123456`)." },
    "http-url": { severity: "warning", description: "An `http://` link: ForgeScript only accepts `https://`, and turns it into a broken link." },
    "unused-variable": { severity: "warning", description: "`$let` of a variable nothing in the code reads." },
    "hidden-output": { severity: "info", description: "`$let[x;$fn]` that is never read, only to hide `$fn`'s output: `$!fn` does that." },
    "unset-variable": { severity: "warning", description: "`$get` of a variable nothing in the code sets: always empty." },
    "wrong-store": { severity: "warning", description: "`$get` of a value only `$env` can read, or `$env` of a `$let` variable: always empty." },
    deprecated: { severity: "warning", description: "A function its package marks as deprecated." },
    "escaped-letter": { severity: "info", description: "`\\n` (or another letter) inside an argument is just the letter: the backslash is dropped." },
    "function-case": { severity: "info", description: "A name in other letter case than declared. It works; the declared spelling is easier to search." },
};
const COMPILE_RULE = {
    "requires-brackets": "missing-brackets",
    "too-many-args": "too-many-arguments",
    "missing-closure": "unclosed-bracket",
};
/** Code that runs in a copy of the caller's variables, or code nobody can see from here. */
const OPAQUE = new Set(["$eval", "$djseval", "$callfunction", "$calllocalfunction", "$scope", "$settimeout", "$setinterval", "$awaitcomponent", "$awaitmodalsubmit"]);
/** The argument of an environment writer that names the variable. */
const ENV_NAME_ARG = /^(variable|var|name|output variable|variable name)$/i;
/** Every problem in one string of code. */
function checkCode(code, table, options = {}, result = (0, parser_1.parse)(code, table, { recover: true })) {
    const out = [];
    const add = (rule, message, start, end) => out.push({ rule, severity: exports.Rules[rule].severity, message, start, end: Math.max(end, start) });
    const calls = Array.from((0, parser_1.walk)(result.functions));
    for (const e of result.errors) {
        const fn = table.get(e.fn);
        const hint = fn && fn.params ? `. Usage: ${(0, table_1.usage)(fn)}` : "";
        add(COMPILE_RULE[e.kind], `${e.message}${hint}`, e.start, e.end);
    }
    for (const call of calls) {
        const fn = call.fn;
        if (fn.args === null && code[call.nameEnd] === "[") {
            add("unexpected-brackets", `${call.name} takes no arguments, so "[" and what follows it are printed as text`, call.nameEnd, call.nameEnd + 1);
        }
        if (fn.deprecated)
            add("deprecated", `${call.name} is deprecated${fn.package ? ` in ${fn.package}` : ""}`, call.start, call.nameEnd);
        const declared = declaredSpelling(call);
        if (declared)
            add("function-case", `Declared as $${declared}; $${call.written.slice(1)} works too, since names ignore case`, call.nameStart, call.nameEnd);
        // Only where ForgeScript resolves the arguments itself: functions like $if read their own fields.
        if (call.fields && fn.params && fn.unwrap) {
            const missing = missingArgument(fn, call.fields);
            if (missing)
                add("too-few-arguments", `${call.name} is missing its argument "${missing}", so ForgeScript stops the command: "Function ${call.name} is missing argument ${missing}". Usage: ${(0, table_1.usage)(fn)}`, call.start, call.close !== null ? call.close + 1 : call.end);
            if (options.values) {
                call.fields.forEach((field, i) => {
                    const param = paramAt(fn.params, i);
                    const text = literal(field);
                    if (!param || text === null)
                        return;
                    const problem = options.values.check(param, text, call.name);
                    if (problem)
                        out.push({ rule: problem.rule, severity: problem.severity, message: problem.message, start: field.start, end: field.end });
                });
            }
        }
        for (const field of call.fields ?? []) {
            if (field.kind === "condition")
                conditionProblems(code, call, field, add);
            for (const part of field.kind === "condition" ? [field.lhs, ...(field.rhs ? [field.rhs] : [])] : [field])
                textProblems(code, call, part, add);
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
    misplacedOperators(code, calls, add);
    // Code that does not compile never runs: what its variables would do does not matter.
    if (!result.errors.length)
        variableProblems(calls, options, add);
    return out.sort((a, b) => a.start - b.start || a.end - b.end);
}
/** The first required argument the call does not have, or `null`. */
function missingArgument(fn, fields) {
    const params = fn.params ?? [];
    for (let i = 0; i < params.length; i++)
        if (params[i].required && i >= fields.length)
            return params[i].name;
    return null;
}
function paramAt(params, i) {
    if (i < params.length)
        return params[i];
    const last = params[params.length - 1];
    return last?.rest ? last : undefined;
}
/** The argument's text when it is plain text (no calls, nothing filled in when the bot runs). */
function literal(field) {
    if (field.kind !== "field" || field.functions.length || field.value.includes("\u0000"))
        return null;
    return field.value;
}
/** The spelling the function or alias is declared with, when the written one differs only in case. */
function declaredSpelling(call) {
    const written = call.written.slice(1);
    for (const name of [call.fn.name, ...(call.fn.aliases ?? [])]) {
        const bare = name.replace(/^\$/, "");
        if (bare.toLowerCase() === written.toLowerCase())
            return bare === written ? null : bare;
    }
    return null;
}
/** The characters of a field outside its calls, with whether each was escaped with `\`. */
function textOf(code, field) {
    const out = [];
    let k = 0;
    for (let i = field.start; i < field.end && i < code.length;) {
        const inner = field.functions[k];
        if (inner && i === inner.start) {
            i = inner.end;
            k++;
            continue;
        }
        if (code[i] === "\\" && i + 1 < code.length) {
            out.push({ at: i, ch: code[i + 1], escaped: true });
            i += 2;
            continue;
        }
        out.push({ at: i, ch: code[i], escaped: false });
        i++;
    }
    return out;
}
function textProblems(code, call, field, add) {
    const open = [];
    for (const { at, ch, escaped } of textOf(code, field)) {
        if (!escaped && ch === "[")
            open.push(at);
        else if (escaped && ch === "]" && open.length)
            open.pop();
        else if (escaped && /[A-Za-z0-9]/.test(ch)) {
            add("escaped-letter", `\\${ch} inside ${call.name}'s argument is just "${ch}": ForgeScript drops the backslash${ch === "n" ? ". For a new line, use a real line break" : ""}`, at, at + 2);
        }
    }
    // Brackets in text are not counted: a ] meant for a [ in the text closes the function.
    if (open.length && code[field.end] === "]") {
        add("unescaped-bracket", `This ] closes ${call.name}, not the [ in its text, so what follows is printed. Escape both as \\[ and \\] (\\\\[ and \\\\] in a JavaScript string)`, field.end, field.end + 1);
    }
}
function conditionProblems(code, call, field, add) {
    const plain = (f) => textOf(code, f).filter((c) => !c.escaped).map((c) => c.ch).join("");
    if (field.op !== "unknown" && field.rhs) {
        const rhs = plain(field.rhs);
        const second = parser_1.Operators.find((op) => rhs.includes(op));
        if (second)
            add("condition-operator", `Only the first operator counts in ${call.name}: the right side of ${field.op} is the text ${JSON.stringify(field.rhs.raw)}. To combine conditions, use $and[...;...] or $or[...;...]`, field.start, field.end);
        return;
    }
    const text = plain(field.lhs);
    if (text.includes("&&") || text.includes("||")) {
        add("condition-operator", `&& and || are not operators in ForgeScript, so ${call.name} compares nothing here. Use $and[...;...] or $or[...;...]`, field.start, field.end);
    }
    else if (!field.lhs.functions.length && !["", "true", "false"].includes(text.trim())) {
        add("condition-operator", `${JSON.stringify(text)} has no operator, so ${call.name} only treats it as true when it is exactly "true"`, field.start, field.end);
    }
}
/** `$` with `!`, `#` or `@[...]` in another order than `$!#@[...]name`, or followed by another `$`. */
function misplacedOperators(code, calls, add) {
    const starts = new Set(calls.map((c) => c.start));
    for (const m of code.matchAll(/\$((?:[!#]|@\[[^\]\n\r]*\])+)(\$?)/g)) {
        const at = m.index;
        if (starts.has(at) || code[at - 1] === "\\")
            continue;
        const valid = /^!?#?(@\[[^\]\n\r]*\])?$/.test(m[1]);
        if (m[2])
            add("misplaced-operator", `"$${m[1]}" is followed by another $, so it applies to nothing and is printed. Write $${m[1]}name[...] with no $ in between`, at, at + m[0].length);
        else if (!valid)
            add("misplaced-operator", `"$${m[1]}" is not in ForgeScript's order ($ then !, then #, then @[...]), so the call is printed as text`, at, at + m[0].length);
    }
}
function variableProblems(calls, options, add) {
    // Only when every function's use of the variables is known (read from its source): a custom
    // function or an extension known only from metadata can read or set variables where they cannot
    // be seen, and $eval and the like run code nobody sees here.
    if (!calls.length || calls.some((c) => !c.fn.stores || c.fn.package === "custom" || OPAQUE.has(c.name.toLowerCase())))
        return;
    const first = (c) => (c.fields?.[0] ? literal(c.fields[0]) : null);
    const set = new Map();
    const read = new Set();
    const env = new Set();
    for (const c of calls) {
        const s = c.fn.stores;
        if (s.setsVariable || s.readsVariable) {
            const name = first(c);
            if (name === null)
                return; // a computed name could be any variable
            if (s.setsVariable && !set.has(name))
                set.set(name, c);
            if (s.readsVariable)
                read.add(name);
        }
        if (s.setsEnvironment) {
            c.fn.params?.forEach((p, i) => {
                const v = ENV_NAME_ARG.test(p.name) && c.fields?.[i] ? literal(c.fields[i]) : null;
                if (v)
                    env.add(v);
            });
        }
    }
    for (const [name, c] of set) {
        if (read.has(name) || c.name.toLowerCase() !== "$let")
            continue;
        const value = c.fields?.[1];
        const only = value?.kind === "field" && value.functions.length === 1 && value.value.trim() === `[SYSTEM_FUNCTION(${value.functions[0].index})]` ? value.functions[0] : null;
        if (only)
            add("hidden-output", `$let[${name};...] is never read, so it only hides the output of ${only.name}: $!${only.written.slice(1)} does that without a variable`, c.start, c.end);
        else
            add("unused-variable", `$let[${name};...] is never read: nothing here uses $get[${name}]`, c.start, c.end);
    }
    for (const c of calls) {
        const name = first(c);
        if (!name)
            continue;
        const n = c.name.toLowerCase();
        if (n === "$get" && !set.has(name)) {
            if (env.has(name))
                add("wrong-store", `${name} is set by an environment function here, which $env reads: $get[${name}] is always empty. Use $env[${name}]`, c.start, c.end);
            else if (!options.customFunction)
                add("unset-variable", `$get[${name}] reads a variable nothing here sets with $let, so it is always empty`, c.start, c.end);
        }
        if (n === "$env" && set.has(name) && !env.has(name) && !options.customFunction) {
            add("wrong-store", `${name} is set with $let, which $get reads: $env[${name}] is always empty. Use $get[${name}]`, c.start, c.end);
        }
    }
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
function distance(a, b, limit = Infinity) {
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