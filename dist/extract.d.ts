/** A string value of a `code:` (or other configured) property. */
export interface CodeSource {
    /** The property, e.g. `code`. */
    property: string;
    /** The string as ForgeScript receives it. `${...}` parts are replaced by {@link DYNAMIC}. */
    value: string;
    /** `offsets[i]`: where `value[i]` comes from in the file. */
    offsets: number[];
    /** The opening quote. */
    start: number;
    /** Right after the closing quote. */
    end: number;
    /** A template literal with `${...}`: those parts are only known when the bot runs. */
    dynamic: boolean;
    /** Why the literal could not be read to its end, if it could not. */
    error: string | null;
}
/** Stands for each `${...}` in a template literal. */
export declare const DYNAMIC = "\0";
interface Cooked {
    value: string;
    offsets: number[];
    end: number;
    dynamic: boolean;
    error: string | null;
}
/** Reads the string or template literal whose opening quote is at `text[i]`, as JavaScript would. */
export declare function cook(text: string, i: number): Cooked;
/**
 * Whether a `/` at `text[i]` (not a comment) starts a regular expression literal, judged as
 * JavaScript's grammar does in practice: after a value (a name, number, string, `)` or `]`) it is a
 * division; after an operator, punctuation, a keyword such as `return`, or nothing, a regex.
 */
export declare function regexCanStart(text: string, i: number, from?: number): boolean;
/** The end of the regular expression literal starting at `text[i]`, past its flags. */
export declare function skipRegex(text: string, i: number): number;
/** The end of the line or block comment starting at `text[i]`; the end of the text when a block comment is never closed. */
export declare function skipComment(text: string, i: number): number;
/**
 * Every string value of the given properties (default `code`) in a JavaScript or TypeScript file,
 * as ForgeScript receives it, with where each character comes from. Comments and other strings are
 * skipped, so `code:` inside them does not count.
 */
export declare function extractCode(text: string, properties?: readonly string[]): CodeSource[];
/** The file offset of `source.value[index]` (or right after the last character). */
export declare function fileOffset(source: CodeSource, index: number): number;
/**
 * Line and column lookups for one text, after one pass over it: for many offsets in the same file
 * (each finding's start and end), where {@link lineColumn} would scan from the start every time.
 */
export declare function lineIndex(text: string): (offset: number) => {
    line: number;
    column: number;
};
/** 1-based line and column of a file offset. */
export declare function lineColumn(text: string, offset: number): {
    line: number;
    column: number;
};
export {};
//# sourceMappingURL=extract.d.ts.map