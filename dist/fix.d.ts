import { ParseResult } from "./parser";
import { FunctionTable } from "./table";
export interface Fix {
    rule: "function-case" | "unescaped-bracket" | "reindent";
    /** File offset of the first character changed, in the text before the fix. */
    offset: number;
    description: string;
}
export interface FixOptions {
    /** Properties whose strings are code (default `["code"]`). */
    properties?: string[];
    /** Fix the letter case of names (default true). */
    case?: boolean;
    /** Escape brackets that close a function too early (changes what the bot sends). */
    brackets?: boolean;
    /** Re-indent lines that start with a function, ; or ] (can change what the bot sends). */
    reindent?: boolean;
    /** Spaces per level, or "tab". Default: detected from the code, else 4. */
    indent?: number | "tab";
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