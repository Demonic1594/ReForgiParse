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
 * Every string value of the given properties (default `code`) in a JavaScript or TypeScript file,
 * as ForgeScript receives it, with where each character comes from. Comments and other strings are
 * skipped, so `code:` inside them does not count.
 */
export declare function extractCode(text: string, properties?: readonly string[]): CodeSource[];
/** The file offset of `source.value[index]` (or right after the last character). */
export declare function fileOffset(source: CodeSource, index: number): number;
/** 1-based line and column of a file offset. */
export declare function lineColumn(text: string, offset: number): {
    line: number;
    column: number;
};
export {};
//# sourceMappingURL=extract.d.ts.map