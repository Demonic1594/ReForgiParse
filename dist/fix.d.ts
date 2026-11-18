import { ParseResult } from "./parser";
import { FunctionTable } from "./table";
export interface Fix {
    rule: "function-case" | "unescaped-bracket";
    /** File offset of the first character changed, in the text before the fix. */
    offset: number;
    description: string;
}
export interface FixOptions {
    /** Properties whose strings are code (default `["code"]`). */
    properties?: string[];
    /** Also escape brackets that close a function too early (changes what the bot sends). */
    brackets?: boolean;
}
export interface FixResult {
    text: string;
    fixes: Fix[];
    /** Edits that were found but not made, and why. */
    skipped: Fix[];
}
/** The fixes for one file's text. */
export declare function fixText(text: string, table: FunctionTable, options?: FixOptions): FixResult;
/** Two parses mean the same: same functions (by registered name), flags, fields, operators, template and errors. */
export declare function sameMeaning(a: ParseResult, b: ParseResult): boolean;
//# sourceMappingURL=fix.d.ts.map