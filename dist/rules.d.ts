import { Call, ParseResult } from "./parser";
import { FunctionTable } from "./table";
export type Severity = "error" | "warning";
/** A problem in a string of code. Offsets are into that string. */
export interface Finding {
    rule: Rule;
    severity: Severity;
    message: string;
    start: number;
    end: number;
}
export type Rule = "missing-brackets" | "too-many-arguments" | "unclosed-bracket" | "too-few-arguments" | "unexpected-brackets" | "unknown-function" | "glued-name";
/** What each rule finds, and its severity. */
export declare const Rules: Record<Rule, {
    severity: Severity;
    description: string;
}>;
/** Every problem in one string of code. */
export declare function checkCode(code: string, table: FunctionTable, result?: ParseResult): Finding[];
/** The closest function name to a mistyped one, or `null` when none is close enough. */
export declare function suggest(written: string, table: FunctionTable): string | null;
export type { Call };
//# sourceMappingURL=rules.d.ts.map