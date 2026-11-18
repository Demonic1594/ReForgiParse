import { Severity } from "./rules";
import { FunctionTable, IRawFunction } from "./table";
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
    /** A rule of {@link Rules}, or `unknown-event` or `unreadable-string`. */
    rule: string;
    message: string;
}
/** Where a function list came from. */
export interface FunctionSource {
    /** `@tryforge/forgescript`, an extension's package name, or `custom`. */
    name: string;
    version: string | null;
    functions: number;
}
export interface ProjectOptions {
    /** Properties whose string values are ForgeScript code (default `["code"]`). */
    properties?: string[];
    /** Folders or files to check, relative to the root (default: the whole root). */
    include?: string[];
}
/** A custom function found in the bot's files (`{ name, params, code }`). */
export interface CustomFunction {
    name: string;
    params: Array<string | {
        name: string;
        rest?: boolean;
        required?: boolean;
    }>;
    brackets: boolean | undefined;
    firstParamCondition: boolean;
    file: string;
}
export declare class Project {
    readonly root: string;
    readonly files: string[];
    private readonly properties;
    readonly table: FunctionTable;
    readonly sources: FunctionSource[];
    readonly customFunctions: CustomFunction[];
    /** What could not be read; shown, never fatal. */
    readonly notes: string[];
    /** Event names a command's `type` can be, `null` when ForgeScript's could not be read. */
    readonly events: Set<string> | null;
    private constructor();
    /** Reads a bot's folder: its `package.json`, installed packages and code files. */
    static load(root: string, options?: ProjectOptions): Project;
    /** Checks every file. */
    check(): Diagnostic[];
    /** Checks one file (absolute, or relative to the root). */
    checkFile(file: string): Diagnostic[];
    private checkSource;
}
/**
 * The functions and event names an extension defines in code: its `NativeFunction` files and event
 * handlers, loaded without starting the extension. Only files that mention them are loaded.
 */
export declare function readNatives(dir: string): {
    functions: IRawFunction[];
    events: string[];
    failures: string[];
};
/** A custom function as the compiler sees it (`ForgeFunction.asNative`, then `FunctionManager.raw`). */
export declare function customAsRaw(c: Pick<CustomFunction, "name" | "params" | "brackets" | "firstParamCondition">): IRawFunction;
//# sourceMappingURL=project.d.ts.map