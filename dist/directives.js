"use strict";
// SPDX-License-Identifier: LGPL-3.0-or-later
//
// Comments that turn rules off, written in ForgeScript (`$c[...]`, which prints nothing) or as
// JavaScript comments in the file:
//
//   $c[reforgiparse-disable-next-line unknown-function]
//   $pingms $c[reforgiparse-disable-line glued-name]
//   $c[reforgiparse-disable] ... $c[reforgiparse-enable]
//   // reforgiparse-disable-next-line invalid-argument
//
// Without rule names a directive covers every rule. `forgelint-` directives are read the same way,
// so a bot moving from ForgeLint keeps the ones it has.
Object.defineProperty(exports, "__esModule", { value: true });
exports.directivesIn = directivesIn;
exports.isSuppressed = isSuppressed;
const DIRECTIVE = /(\$c\[|\/\/|\/\*)\s*(reforgiparse|forgelint)-(disable-next-line|disable-line|disable|enable)\b([^\n\]]*?)(?=\]|\*\/|\n|$)/g;
/** Every directive in a file's text. */
function directivesIn(text) {
    const out = [];
    let line = 1;
    let lineStart = 0;
    let scanned = 0;
    for (const m of text.matchAll(DIRECTIVE)) {
        for (let i = scanned; i < m.index; i++)
            if (text[i] === "\n")
                line++, (lineStart = i + 1);
        scanned = m.index;
        out.push({
            kind: m[3],
            rules: m[4].split(/[\s,]+/).filter(Boolean),
            line,
            column: m.index - lineStart + 1,
            prefix: m[2],
        });
    }
    return out;
}
/** Whether a problem at `line` with `rule` is turned off by the file's directives. */
function isSuppressed(directives, line, rule) {
    const covers = (d) => !d.rules.length || d.rules.includes(rule);
    let off = false;
    for (const d of directives) {
        if (d.line > line)
            break;
        if (d.kind === "disable" && covers(d))
            off = true;
        else if (d.kind === "enable" && covers(d))
            off = false;
    }
    if (off)
        return true;
    return directives.some((d) => covers(d) && ((d.kind === "disable-line" && d.line === line) || (d.kind === "disable-next-line" && d.line + 1 === line)));
}
//# sourceMappingURL=directives.js.map