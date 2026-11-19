import { IParam } from "./table";
/** Why a value is refused or misread, or `null` when it is fine. */
export interface ValueProblem {
    severity: "error" | "warning";
    /** `invalid-argument`, `color-value` or `http-url`. */
    rule: "invalid-argument" | "color-value" | "http-url";
    message: string;
}
interface ForgeScriptValues {
    Conditions?: Record<string, (lhs: string, rhs: string | null) => boolean>;
    CompiledFunction?: {
        prototype: Record<string, any>;
        IdRegex?: RegExp;
        URLRegex?: RegExp;
        CDNIdRegex?: RegExp;
    };
}
export declare class ValueChecker {
    private readonly proto;
    private readonly self;
    private readonly idRegex;
    private readonly cdnRegex;
    private readonly parseEmoji;
    private readonly colors;
    private readonly conditions;
    /** @param forgescript The bot's installed ForgeScript module, for its exact resolvers. Without it, a built-in copy of the 2.8.0 rules is used. */
    constructor(forgescript?: ForgeScriptValues | null, discord?: {
        Colors?: Record<string, number>;
        parseEmoji?: (text: string) => {
            id?: string | null;
        } | null;
    } | null);
    /** What ForgeScript's `Conditions` (core/Compiler.js) gives for fixed text: `null` without ForgeScript. */
    condition(op: string, lhs: string, rhs: string | null): boolean | null;
    /**
     * Checks one literal argument. `text` is the argument after escapes, as ForgeScript resolves it.
     * Follows CompiledFunction.resolveArg: an optional argument left empty is not resolved at all.
     */
    check(param: IParam, text: string, fn: string): ValueProblem | null;
    private color;
    private resolve;
}
export {};
//# sourceMappingURL=values.d.ts.map