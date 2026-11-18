import { FunctionTable, IRawFunction } from "./table";
export declare const Syntax: {
    readonly Open: "[";
    readonly Close: "]";
    readonly Escape: "\\";
    readonly Separator: ";";
};
/** Condition operators, two-character ones first (`OperatorType` in ForgeScript). */
export declare const Operators: readonly ["==", "!=", "<=", ">=", ">", "<"];
export type Operator = (typeof Operators)[number] | "unknown";
/** A placeholder in a template, with any backslashes right before it (`Compiler.SystemRegex`). */
export declare const PlaceholderRegex: RegExp;
/** An argument. Offsets are UTF-16 indexes into the source, like JavaScript string indexes. */
export interface Field {
    kind: "field";
    /** The text with each call replaced by its placeholder and escapes resolved (`value`). */
    value: string;
    /** The text with escapes resolved and calls as written (`rawValue`). */
    raw: string;
    /** The calls right inside it, in order. */
    functions: Call[];
    /** The first character. */
    start: number;
    /** The `;` or `]` that ends it, or the source's length when it is not closed. */
    end: number;
}
/** A condition argument (`$if[$get[a]>=1;...]`), split at its first operator. */
export interface ConditionField {
    kind: "condition";
    /** `"unknown"` when the field has no operator: then all of it is `lhs`. */
    op: Operator;
    lhs: Field;
    rhs: Field | null;
    /** Where the operator is, `null` without one. */
    opStart: number | null;
    start: number;
    end: number;
}
export type AnyField = Field | ConditionField;
/** A function call. */
export interface Call {
    /** The name of the function that runs, as registered (`$authorID` for `$AUTHORID`). */
    name: string;
    /** The name as written, without `!`, `#` or `@[...]`. */
    written: string;
    fn: IRawFunction;
    /** ForgeScript's number for it: inner calls come first. Its placeholder is `[SYSTEM_FUNCTION(index)]`. */
    index: number;
    negated: boolean;
    silent: boolean;
    /** The text in `@[...]`, `null` without it. */
    count: string | null;
    /** `null` without brackets (or for a function that takes none). */
    fields: AnyField[] | null;
    /** The `$`. */
    start: number;
    nameStart: number;
    nameEnd: number;
    /** The `[`, `null` without brackets. */
    open: number | null;
    /** The `]`, `null` without brackets or when it is not closed. */
    close: number | null;
    /** The `;` between arguments. */
    separators: number[];
    /** Right after the call. */
    end: number;
}
export type CompileErrorKind = "requires-brackets" | "too-many-args" | "missing-closure";
/** A compile error, with ForgeScript's message and position. */
export declare class CompileError extends Error {
    /** 1-based, as ForgeScript reports it. */
    readonly line: number;
    /** 0-based, in UTF-16 units, as ForgeScript reports it. */
    readonly column: number;
    readonly offset: number;
    readonly kind: CompileErrorKind;
    constructor(message: string, 
    /** 1-based, as ForgeScript reports it. */
    line: number, 
    /** 0-based, in UTF-16 units, as ForgeScript reports it. */
    column: number, offset: number, kind: CompileErrorKind);
}
export interface ParseResult {
    /** The source. */
    source: string;
    /** The top level as a template, with a placeholder per call (`Compiler.compile().code`). */
    code: string;
    /** The top-level calls. */
    functions: Call[];
    /** Every compile error. In strict mode there are none: the first one is thrown. */
    errors: CompileError[];
}
export interface ParseOptions {
    /** Keep going after an error and record every one in `errors` (default: throw the first, like ForgeScript). */
    recover?: boolean;
}
export declare function placeholder(index: number): string;
/**
 * Parses ForgeScript code the way ForgeScript compiles it.
 *
 * Strict (default): throws a {@link CompileError} at the first error, where ForgeScript does.
 * `recover: true`: records every error in `errors` and keeps going; without errors the tree is the
 * same as in strict mode.
 */
export declare function parse(code: string, table: FunctionTable, options?: ParseOptions): ParseResult;
/**
 * Fills a template's placeholders in order of appearance, dropping backslashes right before them,
 * as ForgeScript does when it builds a command's text (`Compiler.wrap`).
 */
export declare function render(template: string, values: readonly unknown[]): string;
/** Every call, outer before inner, in source order. */
export declare function walk(calls: readonly Call[]): Generator<Call>;
//# sourceMappingURL=parser.d.ts.map