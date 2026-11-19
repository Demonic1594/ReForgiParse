import { Level } from "./config";
import { EventModel, Severity } from "./rules";
import { FunctionTable } from "./table";
import { ValueChecker } from "./values";
/** One problem, at a place in a file. */
export interface Diagnostic {
    /** Relative to the project's root, `/`-separated. */
    file: string;
    /** 1-based. */
    line: number;
    /** 1-based. */
    column: number;
    endLine: number;
    endColumn: number;
    severity: Severity;
    /** A rule of {@link Rules}, or one of {@link ProjectRules}. */
    rule: string;
    message: string;
}
/** Rules that need the whole file, not only the code: what they find and their default level. */
export declare const ProjectRules: {
    readonly "unknown-event": {
        readonly severity: "error";
        readonly description: "A command's `type` that no loaded package has as an event: the command never runs.";
    };
    readonly "unreadable-string": {
        readonly severity: "warning";
        readonly description: "A `code:` string JavaScript would not end where it seems to: it is not checked.";
    };
    readonly "unknown-rule": {
        readonly severity: "warning";
        readonly description: "A `reforgiparse-disable` comment that names no rule: it turns nothing off.";
    };
};
export interface ScriptOptions {
    /** The file's path, as reported in each diagnostic (and to find custom functions in a `functions` folder). */
    file?: string;
    /** Properties whose strings are code (default `["code"]`). */
    properties?: string[];
    /** Checks literal argument values with the bot's ForgeScript (see `ValueChecker`). */
    values?: ValueChecker;
    /** Event names a command's `type` can be; without them, types are not checked. */
    events?: ReadonlySet<string> | null;
    /** Levels from the config: `error`, `warning`, `info` or `off` per rule. */
    rules?: Record<string, Level>;
    /** What each event gives a command's code, to check functions against the command's `type`. */
    eventModel?: ReadonlyMap<string, EventModel> | null;
}
/** Every problem in one JavaScript or TypeScript file's text, with directives and levels applied. */
export declare function checkScript(text: string, table: FunctionTable, options?: ScriptOptions): Diagnostic[];
export declare function closest(word: string, names: Iterable<string>): string | null;
export * from "./table";
export * from "./parser";
export * from "./names";
export * from "./extract";
export * from "./rules";
export * from "./values";
export * from "./fix";
export * from "./directives";
//# sourceMappingURL=core.d.ts.map