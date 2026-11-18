import { ParseResult } from "./parser";
import { FunctionTable } from "./table";
/** A `$word` that ForgeScript does not run as written. */
export interface NameIssue {
    /**
     * `unknown`: no function has this name, so it is printed as text.
     * `glued`: a shorter function name matches its start, so that function runs and the rest is
     * printed after it (`$pingms` runs `$ping`, then prints `ms`).
     */
    kind: "unknown" | "glued";
    start: number;
    end: number;
    /** As written, e.g. `$pingms`. */
    written: string;
    /** For `glued`: the function that runs. */
    runs: string | null;
    /** For `glued`: the text printed after it. */
    rest: string;
}
/**
 * The `$words` ForgeScript does not treat as written. It uses the compiler's own matching, so it
 * agrees with what runs; escaped `\$words` are skipped.
 */
export declare function nameIssues(code: string, table: FunctionTable, result?: ParseResult): NameIssue[];
//# sourceMappingURL=names.d.ts.map