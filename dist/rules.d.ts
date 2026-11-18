import { ParseResult } from "./parser";
import { FunctionTable } from "./table";
import { ValueChecker } from "./values";
export type Severity = "error" | "warning" | "info";
/** A problem in a string of code. Offsets are into that string. */
export interface Finding {
    rule: Rule;
    severity: Severity;
    message: string;
    start: number;
    end: number;
}
/** What each rule finds, and its severity. */
export declare const Rules: {
    readonly "missing-brackets": {
        readonly severity: "error";
        readonly description: "A function that needs brackets has none. ForgeScript refuses to compile the code.";
    };
    readonly "too-many-arguments": {
        readonly severity: "error";
        readonly description: "More arguments than the function takes. ForgeScript refuses to compile the code.";
    };
    readonly "unclosed-bracket": {
        readonly severity: "error";
        readonly description: "A `[` that is never closed. ForgeScript refuses to compile the code.";
    };
    readonly "too-few-arguments": {
        readonly severity: "error";
        readonly description: "A required argument is missing: the command stops with \"missing argument\".";
    };
    readonly "invalid-argument": {
        readonly severity: "error";
        readonly description: "An argument ForgeScript cannot read as its type: the command stops with \"invalid argument\".";
    };
    readonly "unexpected-brackets": {
        readonly severity: "warning";
        readonly description: "Brackets after a function that takes no arguments: they and their text are printed.";
    };
    readonly "unknown-function": {
        readonly severity: "warning";
        readonly description: "A `$name` that is no function here, so it is printed as text.";
    };
    readonly "glued-name": {
        readonly severity: "warning";
        readonly description: "A `$name` whose start is another function: that one runs, and the rest is printed.";
    };
    readonly "misplaced-operator": {
        readonly severity: "warning";
        readonly description: "`!`, `#` or `@[...]` in the wrong order, or before another `$`: the call is printed as text.";
    };
    readonly "condition-operator": {
        readonly severity: "warning";
        readonly description: "A condition ForgeScript reads differently: a second operator, `&&` or `||`, or no operator at all.";
    };
    readonly "unescaped-bracket": {
        readonly severity: "warning";
        readonly description: "A `]` meant for a `[` in the text closes the function instead; the rest is printed.";
    };
    readonly "color-value": {
        readonly severity: "warning";
        readonly description: "A colour ForgeScript reads differently from what was meant (`blue`, `123456`).";
    };
    readonly "http-url": {
        readonly severity: "warning";
        readonly description: "An `http://` link: ForgeScript only accepts `https://`, and turns it into a broken link.";
    };
    readonly "unused-variable": {
        readonly severity: "warning";
        readonly description: "`$let` of a variable nothing in the code reads.";
    };
    readonly "hidden-output": {
        readonly severity: "info";
        readonly description: "`$let[x;$fn]` that is never read, only to hide `$fn`'s output: `$!fn` does that.";
    };
    readonly "unset-variable": {
        readonly severity: "warning";
        readonly description: "`$get` of a variable nothing in the code sets: always empty.";
    };
    readonly "wrong-store": {
        readonly severity: "warning";
        readonly description: "`$get` of a value only `$env` can read, or `$env` of a `$let` variable: always empty.";
    };
    readonly deprecated: {
        readonly severity: "warning";
        readonly description: "A function its package marks as deprecated.";
    };
    readonly "escaped-letter": {
        readonly severity: "info";
        readonly description: "`\\n` (or another letter) inside an argument is just the letter: the backslash is dropped.";
    };
    readonly "function-case": {
        readonly severity: "info";
        readonly description: "A name in other letter case than declared. It works; the declared spelling is easier to search.";
    };
};
export type Rule = keyof typeof Rules;
export interface CheckOptions {
    /** Checks literal argument values. Without it, only the rules that need no ForgeScript run. */
    values?: ValueChecker;
    /** The code is a custom function's body: it can read the caller's `$let` variables. */
    customFunction?: boolean;
}
/** Every problem in one string of code. */
export declare function checkCode(code: string, table: FunctionTable, options?: CheckOptions, result?: ParseResult): Finding[];
/** The closest function name to a mistyped one, or `null` when none is close enough. */
export declare function suggest(written: string, table: FunctionTable): string | null;
/** Edit distance with transpositions, giving up above `limit`. */
export declare function distance(a: string, b: string, limit?: number): number;
//# sourceMappingURL=rules.d.ts.map