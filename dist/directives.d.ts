export type DirectiveKind = "disable" | "enable" | "disable-line" | "disable-next-line";
export interface Directive {
    kind: DirectiveKind;
    /** The rules it covers; empty for every rule. */
    rules: string[];
    /** 1-based line in the file. */
    line: number;
    column: number;
    /** `reforgiparse` or `forgelint`. */
    prefix: string;
}
/** Every directive in a file's text. */
export declare function directivesIn(text: string): Directive[];
/** Whether a problem at `line` with `rule` is turned off by the file's directives. */
export declare function isSuppressed(directives: readonly Directive[], line: number, rule: string): boolean;
//# sourceMappingURL=directives.d.ts.map