/** One argument as the compiler sees it. */
export interface IRawField {
    /** The field is a condition (`$if[a==b;...]`): an operator splits it in two. */
    condition?: boolean;
    /** The field takes every remaining argument. */
    rest?: boolean;
}
/** An argument as documented: what usage hints and argument checks need. */
export interface IParam {
    name: string;
    required?: boolean;
    rest?: boolean;
    /** The ArgType name: `String`, `Number`, `Boolean`, `Time`, `Enum`, `User`, ... */
    type?: string;
    /** For an `Enum`: its value names. */
    enum?: readonly string[];
    /** For an `Enum` from a NativeFunction: the enum itself, which ForgeScript looks the text up in (names and, for a numeric enum, its numbers). */
    enumObject?: Readonly<Record<string, string | number>>;
}
/** A function as ForgeScript's compiler sees it (the shape of `FunctionManager.raw`), with its documented arguments when known. */
export interface IRawFunction {
    /** With the `$`, as registered, e.g. `$sendMessage`. */
    name: string;
    aliases?: readonly string[] | null;
    /** `null`: the function takes no brackets, and a `[` after it is plain text. */
    args: {
        /** Brackets are required (`$ping` alone is an error when true). */
        required: boolean;
        fields: readonly IRawField[];
    } | null;
    /** The documented arguments, in order. Not used by the parser; `undefined` when unknown. */
    params?: readonly IParam[];
    /** ForgeScript resolves the arguments before running the function (and so rejects missing ones). */
    unwrap?: boolean;
    deprecated?: boolean;
    /** Where it comes from: `@tryforge/forgescript`, an extension's package name, or `custom`. */
    package?: string;
    /** What it does with the two variable stores, read from its source when known. */
    stores?: {
        setsVariable?: boolean;
        readsVariable?: boolean;
        setsEnvironment?: boolean;
    };
    /**
     * For a function that reads its own arguments (not `unwrap`): the positions it sends through
     * ForgeScript's argument check (`resolveMultipleArgs`, `resolveUnhandledArg`), in the order it
     * does, read from its source. `undefined` when unknown.
     */
    resolved?: readonly number[];
    /**
     * What it reads from its command's event, read from its source: only the interaction, one of the
     * event's states (`message`, `member`...), or a message command's words. Without it, the function
     * gives nothing (see test/runtime.test.js).
     */
    /** It adds to the response its command sends (an embed, a component, a file...) without sending it. Read from its source. */
    builds?: boolean;
    context?: {
        interaction?: boolean;
        state?: string;
        words?: boolean;
        /** Only its own package's events' data (`ctx.runtime.extras`, a giveaway's states): `$voteUserID`. */
        event?: boolean;
        /** The error ForgeScript stops the command with when there is none, if it does. */
        crash?: string;
        /** Its package's events whose data it does not find: each with the TypeError it stops with, or `null` (it gives nothing). */
        missingIn?: Record<string, string | null>;
        /** Its package's events whose data it reads. */
        givenIn?: string[];
    };
    /** What it does, as its package documents it. */
    description?: string;
    /** The ArgType names of what it returns, when documented. */
    output?: readonly string[];
}
/**
 * The functions a bot has, in the order ForgeScript registers them. A later name or alias replaces
 * the earlier function but keeps its place, as `Collection.set` does.
 */
export declare class FunctionTable {
    /** Lower-case name or alias, with `$`, to the function. */
    readonly byKey: Map<string, IRawFunction>;
    /** The regular expression that finds calls (`Compiler.Regex`). */
    readonly regex: RegExp;
    constructor(functions: Iterable<IRawFunction>);
    /** The function a name runs (case-insensitive, with or without `$`). */
    get(name: string): IRawFunction | undefined;
    /** How many names and aliases call a function. */
    get size(): number;
    /** Every function once, whatever names and aliases it has. */
    get functions(): IRawFunction[];
    /**
     * The functions an installed ForgeScript has registered (`FunctionManager.raw`), after the bot's
     * extensions loaded theirs. When none are registered yet (a script, not a running bot), ForgeScript's
     * own are loaded first, as `FunctionManager.loadNative()` does.
     */
    static fromForgeScript(forgescript?: ForgeScriptLike): FunctionTable;
    /**
     * From metadata in the format extensions publish (`metadata/functions.json`: `name`, `aliases`,
     * `brackets`, `args[].condition`, `args[].rest`). Lists are applied in order: as in a bot, an
     * extension loaded first keeps a name a later list (ForgeScript's own) also defines.
     */
    static fromMetadata(...lists: ReadonlyArray<ReadonlyArray<IFunctionMetadata>>): FunctionTable;
}
/** A function in an extension's `metadata/functions.json`. */
export interface IFunctionMetadata {
    name: string;
    aliases?: readonly string[] | null;
    brackets?: boolean | null;
    args?: ReadonlyArray<{
        name?: string;
        condition?: boolean;
        rest?: boolean;
        required?: boolean;
        type?: string;
        enum?: readonly string[];
    }> | null;
    unwrap?: boolean;
    deprecated?: boolean;
    description?: string;
    output?: string | readonly string[] | null;
}
/** One metadata entry as the compiler sees it. */
export declare function fromMetadata(m: IFunctionMetadata): IRawFunction;
/** A function's documented output as ArgType names: from metadata (names) or a NativeFunction (ArgType numbers). */
export declare function outputNames(output: unknown, argType?: Record<number, string>): string[] | undefined;
/** An argument as a NativeFunction defines it: `type` is an ArgType number, `enum` the enum object. */
export interface INativeArg {
    name: string;
    required?: boolean;
    rest?: boolean;
    condition?: boolean;
    type?: number | string;
    enum?: Record<string, string | number>;
}
interface ForgeScriptLike {
    FunctionManager: {
        raw: IRawFunction[];
        loadNative?(): void;
        get?(name: string): {
            path?: string;
            data: {
                args?: INativeArg[];
                unwrap?: boolean;
                deprecated?: boolean;
                description?: string;
                output?: unknown;
            };
        } | undefined;
    };
    ArgType?: Record<number, string>;
}
/** What a function's compiled source does with `$let` variables and the environment store. */
export declare function storesOf(file: string | undefined): IRawFunction["stores"];
/**
 * The argument positions a NativeFunction's `execute` sends through ForgeScript's argument check, in
 * order: `resolveMultipleArgs(ctx, 0, 2)` and `resolveUnhandledArg(ctx, 1)`, or every one for
 * `resolveArgs(ctx)`. `undefined` when the source cannot be read.
 */
export declare function resolvedArgsOf(file: string | undefined, count: number): number[] | undefined;
/** What a NativeFunction reads from its command's event: see {@link IRawFunction.context}. */
export declare function contextOf(file: string | undefined, name: string): IRawFunction["context"];
/**
 * Whether an extension's NativeFunction reads only the data its package's events give a command
 * (`ctx.runtime.extras`, or `ctx.extendedStates`), with nothing else to fall back on: from its source.
 */
export declare function eventDataOf(text: string): IRawFunction["context"];
/** Whether a NativeFunction adds to its command's response without sending it: see {@link IRawFunction.builds}. */
export declare function buildsOf(file: string | undefined): boolean;
/** A NativeFunction's argument, described by name. */
export declare function paramFromNative(a: INativeArg, argType?: Record<number, string>): IParam;
/** `FunctionManager.raw`, with each function's documented arguments from its definition. */
export declare function withParams(forgescript: ForgeScriptLike): IRawFunction[];
/** How a function is written with its arguments: `$sendMessage[channel ID;content?;return message ID?]`. */
export declare function usage(fn: IRawFunction): string;
export {};
//# sourceMappingURL=table.d.ts.map