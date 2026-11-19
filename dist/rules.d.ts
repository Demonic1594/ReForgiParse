import { Call, ParseResult } from "./parser";
import { FunctionTable, IRawFunction } from "./table";
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
        readonly description: "A required argument is missing: the command stops (\"Function $x is missing argument y\").";
    };
    readonly "invalid-argument": {
        readonly severity: "error";
        readonly description: "An argument ForgeScript cannot read as its type: the command stops (\"Given value ... is not of type ...\").";
    };
    readonly "unexpected-brackets": {
        readonly severity: "warning";
        readonly description: "Brackets after a function that takes no arguments: they and their text are printed.";
    };
    readonly "incomplete-call": {
        readonly severity: "warning";
        readonly description: "A function without a required argument that ForgeScript does not check for (`$if[condition]`): it runs, and does nothing, always stops, or never ends.";
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
    readonly "misplaced-statement": {
        readonly severity: "error";
        readonly description: "`$break` or `$continue` outside `$loop` and `$while`, `$return` in a command, or `$ifx` without an `$if`: ForgeScript stops the command.";
    };
    readonly "misplaced-branch": {
        readonly severity: "warning";
        readonly description: "`$else`, `$elseIf` or `$case` outside `$ifx` or `$switch` (it runs every time), or code in `$ifx` or `$switch` that is no branch of it (it never runs).";
    };
    readonly "stray-bracket": {
        readonly severity: "warning";
        readonly description: "A `]` outside any function that no `[` before it opened: it closes nothing and is printed.";
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
/** What leaving out a required argument does, for a function that reads its own arguments. */
export interface UncheckedArgument {
    /** The argument's position. */
    arg: number;
    /**
     * `stops`: ForgeScript's own check stops the command. `crashes`: an internal error stops it.
     * `runs`: the function runs without it. `always-stops`: it always stops the command, with no error.
     * `never-ends`: the command never finishes.
     */
    outcome: "stops" | "crashes" | "runs" | "always-stops" | "never-ends";
    /** For `runs`: what the function then does. */
    does?: string;
    /** For `crashes`: the property ForgeScript's TypeError names. */
    reads?: string;
    /** A call that leaves the argument out, run on ForgeScript's interpreter by the tests. */
    example: string;
}
/**
 * ForgeScript's functions that read their own arguments (not `unwrap`), so that a required one left
 * out is not caught by ForgeScript's usual check: what each does without it. Each entry is run on
 * ForgeScript's interpreter by test/runtime.test.js. Functions whose outcome needs Discord to show
 * are left out.
 */
export declare const UncheckedArguments: Record<string, UncheckedArgument>;
/**
 * Functions whose own work fails on some argument values, which their argument types let through: the
 * same operation as their `execute`, run on the values as ForgeScript resolves them. It throws what
 * ForgeScript would, and that error is what it logs. Each is run on ForgeScript's interpreter by
 * test/runtime.test.js. `later`: the value is stored, and a later function fails on it.
 */
export declare const ExecuteChecks: Record<string, {
    args: number[];
    run: (values: unknown[]) => unknown;
    later?: string;
}>;
/** The parts of the code that ForgeScript prints as written and never runs: the inside of `$escapeCode[...]`. */
export declare function printedAsWritten(result: ParseResult): Array<{
    start: number;
    end: number;
    call: Call;
}>;
/** Every problem in one string of code. */
export declare function checkCode(code: string, table: FunctionTable, options?: CheckOptions, result?: ParseResult): Finding[];
/** The spelling the function or alias is declared with, when the written one differs only in case. */
export declare function declaredSpelling(call: Call): string | null;
/** A `]` that closes its function while a `[` in the argument's text is still open: the `[`s and the `]`. */
export interface UnescapedBracket {
    call: Call;
    opens: number[];
    close: number;
}
/**
 * Every argument whose `]` closes its function while a `[` in its text is open. Calls that contain a
 * compile error are left out: ForgeScript compiles none of the code, and where their brackets belong
 * is only the parser's guess after the error.
 */
export declare function unescapedBrackets(code: string, result: ParseResult): UnescapedBracket[];
/**
 * Every `]` in the code's own text (outside all functions) that no `[` before it in that text opened.
 * ForgeScript prints it; `Page [1/3]` is left alone. Not for code that does not compile, where what is
 * outside the functions is only the parser's guess after the error. A `[` in an argument's text that
 * closes a function early pushes that function's own `]` out, one level per `[`, to the code's text:
 * those are part of that mistake (`unescaped-bracket`) and go with its fix, so they are not counted.
 */
export declare function strayBrackets(code: string, result: ParseResult): number[];
/** The closest function name to a mistyped one, or `null` when none is close enough. `except` is never suggested. */
export declare function suggest(written: string, table: FunctionTable, except?: IRawFunction): string | null;
/** Edit distance with transpositions, giving up above `limit`. */
export declare function distance(a: string, b: string, limit?: number): number;
//# sourceMappingURL=rules.d.ts.map