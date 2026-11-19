export { Diagnostic, ProjectRules } from "./core";
import { Config } from "./config";
import { Diagnostic } from "./core";
import { EventModel } from "./rules";
import { ValueChecker } from "./values";
import { FunctionTable, IRawFunction } from "./table";
/** Where a function list came from. */
export interface FunctionSource {
    /** `@tryforge/forgescript`, an extension's package name, or `custom`. */
    name: string;
    version: string | null;
    functions: number;
}
export interface ProjectOptions {
    /** Properties whose string values are ForgeScript code (default: the config's, else `["code"]`). */
    properties?: string[];
    /** Folders or files to check, relative to the root (default: the config's, else the whole root). */
    include?: string[];
    /** The config to use. Default: the bot's own (`reforgiparse.config.json` or package.json). Pass `{}` for none. */
    config?: Config;
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
    readonly properties: string[];
    readonly config: Config;
    readonly table: FunctionTable;
    readonly sources: FunctionSource[];
    readonly customFunctions: CustomFunction[];
    /** What could not be read; shown, never fatal. */
    readonly notes: string[];
    /** Checks literal argument values with the bot's ForgeScript. */
    readonly values: ValueChecker;
    /** Event names a command's `type` can be, `null` when ForgeScript's could not be read. */
    readonly events: Set<string> | null;
    /** What each of ForgeScript's events gives a command's code, read from its handlers. */
    readonly eventModel: Map<string, EventModel> | null;
    private constructor();
    /** Reads a bot's folder: its `package.json`, installed packages and code files. */
    static load(root: string, options?: ProjectOptions): Project;
    /** Checks every file. */
    check(): Diagnostic[];
    /** Checks one file (absolute, or relative to the root). */
    checkFile(file: string): Diagnostic[];
}
/**
 * The functions and event names an extension defines in code: its `NativeFunction` files and event
 * handlers, loaded without starting the extension. Only files that mention them are loaded.
 */
export declare function readNatives(dir: string, argType?: Record<number, string>): {
    functions: IRawFunction[];
    events: string[];
    failures: string[];
};
/**
 * What each of ForgeScript's events gives a command's code, from its handler's source: the states it
 * sets (`states: { message: ... }`), whether it gives message words (`args` other than `[]`), and an
 * interaction (interactionCreate, whose handler runs commands with the interaction).
 */
export declare function forgeScriptEventModel(forgeDir: string): Map<string, EventModel> | null;
/** A custom function as the compiler sees it (`ForgeFunction.asNative`, then `FunctionManager.raw`). */
export declare function customAsRaw(c: Pick<CustomFunction, "name" | "params" | "brackets" | "firstParamCondition">): IRawFunction;
//# sourceMappingURL=project.d.ts.map