"use strict";
// SPDX-License-Identifier: LGPL-3.0-or-later
//
// ForgeParse: ForgeScript's compiler as a parser.
//
// The algorithm reproduces ForgeScript's own compiler (github.com/tryforge/ForgeScript,
// src/core/Compiler.ts, LGPL-3.0-or-later, Copyright (c) BotForge), so that for any input the
// tree, fields, condition operators, output template and compile errors (message, line and
// column) are the ones ForgeScript produces. test/parity.test.js checks this against the real
// compiler. On top of that it records where everything is in the source, and can keep going after
// an error and report every one (`recover: true`).
Object.defineProperty(exports, "__esModule", { value: true });
exports.CompileError = exports.PlaceholderRegex = exports.Operators = exports.Syntax = void 0;
exports.placeholder = placeholder;
exports.parse = parse;
exports.render = render;
exports.walk = walk;
exports.Syntax = { Open: "[", Close: "]", Escape: "\\", Separator: ";" };
/** Condition operators, two-character ones first (`OperatorType` in ForgeScript). */
exports.Operators = ["==", "!=", "<=", ">=", ">", "<"];
/** A placeholder in a template, with any backslashes right before it (`Compiler.SystemRegex`). */
exports.PlaceholderRegex = /(\\+)?\[SYSTEM_FUNCTION\(\d+\)\]/gm;
/** A compile error, with ForgeScript's message and position. */
class CompileError extends Error {
    line;
    column;
    offset;
    kind;
    constructor(message, 
    /** 1-based, as ForgeScript reports it. */
    line, 
    /** 0-based, in UTF-16 units, as ForgeScript reports it. */
    column, offset, kind) {
        super(message);
        this.line = line;
        this.column = column;
        this.offset = offset;
        this.kind = kind;
        this.name = "CompileError";
    }
}
exports.CompileError = CompileError;
const RECOVER_FIELD = { condition: false, rest: true };
class Compiler {
    code;
    recover;
    matches;
    errors = [];
    id = 0;
    index = 0;
    matchIndex = 0;
    constructor(code, table, recover) {
        this.code = code;
        this.recover = recover;
        this.matches = Array.from(code.matchAll(table.regex), (m) => {
            const nameStart = m.index + 1 + (m[1] ? 1 : 0) + (m[2] ? 1 : 0) + (m[3] ? m[3].length : 0);
            return {
                index: m.index,
                length: m[0].length,
                negated: !!m[1],
                silent: !!m[2],
                count: m[4] ?? null,
                // The regular expression is built from the table, so every match has a function.
                fn: table.get(m[5]),
                written: `$${m[5]}`,
                nameStart,
            };
        });
    }
    get match() {
        return this.matches[this.matchIndex];
    }
    char() {
        return this.code[this.index];
    }
    /**
     * The current offset for a position in the tree. ForgeScript's own index can run past the end
     * (a lone `\` at the end of an unclosed field steps over it); positions never do.
     */
    at() {
        return Math.min(this.index, this.code.length);
    }
    back() {
        return this.code[this.index - 1];
    }
    /** Line (1-based) and column (0-based), counted as ForgeScript counts them. */
    locate(index) {
        let line = 1;
        let column = 0;
        for (let i = 0; i < index; i++) {
            if (this.code[i] === "\n")
                line++, (column = 0);
            else
                column++;
        }
        return { line, column };
    }
    error(message, kind) {
        const { line, column } = this.locate(this.index);
        const err = new CompileError(message, line, column, this.index, kind);
        if (!this.recover)
            throw err;
        this.errors.push(err);
    }
    /** `\x`: the character after the backslash, never a call. Past the end it is `"undefined"`, as in ForgeScript. */
    escape() {
        this.index++;
        const next = this.char();
        if (this.match?.index === this.index)
            this.matchIndex++;
        this.index++;
        return String(next);
    }
    compile() {
        let out = "";
        const functions = [];
        if (this.matches.length) {
            loop: for (let m = this.match; m !== undefined; m = this.match) {
                // Cannot happen in ForgeScript's grammar (matches never overlap what was consumed),
                // but ForgeScript would loop for ever here; skip the match instead.
                if (m.index < this.index) {
                    this.matchIndex++;
                    continue;
                }
                while (m.index !== this.index) {
                    if (this.char() === exports.Syntax.Escape) {
                        out += this.escape();
                        continue loop;
                    }
                    out += this.char();
                    this.index++;
                }
                const call = this.parseFunction();
                functions.push(call);
                out += placeholder(call.index);
            }
            out += this.code.slice(this.index);
        }
        else
            out = this.code;
        return { source: this.code, code: out, functions, errors: this.errors };
    }
    parseFunction() {
        const m = this.matches[this.matchIndex++];
        this.index += m.length;
        const fn = m.fn;
        const nameEnd = this.index;
        const hasFields = this.char() === exports.Syntax.Open;
        if (!hasFields && fn.args?.required) {
            this.error(`Function ${fn.name} requires brackets`, "requires-brackets");
            return this.prepare(m, null, nameEnd);
        }
        if (!hasFields || fn.args === null)
            return this.prepare(m, null, nameEnd);
        const open = this.index++;
        const fields = [];
        const separators = [];
        const specs = fn.args.fields;
        for (let i = 0; i < specs.length; i++) {
            const spec = specs[i];
            if (!spec.rest)
                fields.push(this.parseAnyField(m, spec));
            else {
                for (;;) {
                    fields.push(this.parseAnyField(m, spec));
                    if (this.back() !== exports.Syntax.Separator)
                        break;
                    separators.push(this.index - 1);
                }
            }
            if (this.back() !== exports.Syntax.Separator)
                break;
            if (!spec.rest)
                separators.push(this.index - 1);
            if (i + 1 === specs.length) {
                this.error(`Function ${fn.name} expects ${specs.length} arguments at most`, "too-many-args");
                // Recovering: read the extra arguments so the rest of the code stays in step.
                for (;;) {
                    fields.push(this.parseAnyField(m, RECOVER_FIELD));
                    if (this.back() !== exports.Syntax.Separator)
                        break;
                    separators.push(this.index - 1);
                }
                break;
            }
        }
        const call = this.prepare(m, fields, nameEnd);
        call.open = open;
        call.close = this.back() === exports.Syntax.Close && fields.length ? this.index - 1 : null;
        call.separators = separators;
        return call;
    }
    prepare(m, fields, nameEnd) {
        return {
            name: m.fn.name,
            written: m.written,
            fn: m.fn,
            index: this.id++,
            negated: m.negated,
            silent: m.silent,
            count: m.count,
            fields,
            start: m.index,
            nameStart: m.nameStart,
            nameEnd,
            open: null,
            close: null,
            separators: [],
            end: this.at(),
        };
    }
    parseAnyField(ref, spec) {
        const field = spec.condition ? this.parseConditionField(ref) : this.parseNormalField(ref);
        // Past the `;` or `]` (or one past the end when the field is not closed, as ForgeScript does).
        this.index++;
        return field;
    }
    /**
     * The loop both field kinds share. `onChar` may take a character (the condition operator).
     * Returns whether the field was closed by `;` or `]`.
     */
    readField(acc, onChar) {
        for (let ch = this.char(); ch !== undefined; ch = this.char()) {
            if (ch === exports.Syntax.Escape) {
                const c = this.escape();
                acc.value += c;
                acc.raw += c;
                continue;
            }
            if (ch === exports.Syntax.Close || ch === exports.Syntax.Separator)
                return true;
            const m = this.match;
            if (m?.index === this.index) {
                const start = this.index;
                const call = this.parseFunction();
                acc.functions.push(call);
                acc.value += placeholder(call.index);
                acc.raw += this.code.slice(start, this.index);
                continue;
            }
            if (onChar?.())
                continue;
            acc.value += ch;
            acc.raw += ch;
            this.index++;
        }
        return false;
    }
    parseNormalField(ref) {
        const start = this.index;
        const acc = { value: "", raw: "", functions: [] };
        if (!this.readField(acc))
            this.error(`Function ${ref.fn.name} is missing brace closure`, "missing-closure");
        return { kind: "field", ...acc, start, end: this.at() };
    }
    parseConditionField(ref) {
        const start = this.index;
        let acc = { value: "", raw: "", functions: [] };
        let op = null;
        let opStart = null;
        let lhs = null;
        const closed = this.readField(acc, () => {
            if (op !== null)
                return false;
            const ch = this.char();
            const two = ch + (this.code[this.index + 1] ?? "undefined");
            const found = exports.Operators.includes(two) ? two : exports.Operators.includes(ch) ? ch : null;
            if (found === null)
                return false;
            op = found;
            opStart = this.index;
            lhs = { kind: "field", ...acc, start, end: this.at() };
            acc.value = "";
            acc.raw = "";
            acc.functions = [];
            this.index += found.length;
            return true;
        });
        if (!closed)
            this.error(`Function ${ref.fn.name} is missing brace closure`, "missing-closure");
        if (op !== null) {
            const rhs = { kind: "field", ...acc, start: opStart + op.length, end: this.at() };
            return { kind: "condition", op, lhs: lhs, rhs, opStart, start, end: this.at() };
        }
        return { kind: "condition", op: "unknown", lhs: { kind: "field", ...acc, start, end: this.at() }, rhs: null, opStart: null, start, end: this.at() };
    }
}
function placeholder(index) {
    return `[SYSTEM_FUNCTION(${index})]`;
}
/**
 * Parses ForgeScript code the way ForgeScript compiles it.
 *
 * Strict (default): throws a {@link CompileError} at the first error, where ForgeScript does.
 * `recover: true`: records every error in `errors` and keeps going; without errors the tree is the
 * same as in strict mode.
 */
function parse(code, table, options = {}) {
    return new Compiler(code, table, !!options.recover).compile();
}
/**
 * Fills a template's placeholders in order of appearance, dropping backslashes right before them,
 * as ForgeScript does when it builds a command's text (`Compiler.wrap`).
 */
function render(template, values) {
    let i = 0;
    return template.replace(exports.PlaceholderRegex, () => {
        const v = values[i++];
        return v === undefined || v === null ? "" : String(v);
    });
}
/** Every call, outer before inner, in source order. */
function* walk(calls) {
    for (const call of calls) {
        yield call;
        for (const field of call.fields ?? []) {
            if (field.kind === "field")
                yield* walk(field.functions);
            else {
                yield* walk(field.lhs.functions);
                if (field.rhs)
                    yield* walk(field.rhs.functions);
            }
        }
    }
}
//# sourceMappingURL=parser.js.map