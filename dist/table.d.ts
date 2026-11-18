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
    get size(): number;
    /**
     * The functions an installed ForgeScript has registered (`FunctionManager.raw`), after the bot's
     * extensions loaded theirs. Without a running bot, call `FunctionManager.loadNative()` first.
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
    }> | null;
    unwrap?: boolean;
    deprecated?: boolean;
}
/** One metadata entry as the compiler sees it. */
export declare function fromMetadata(m: IFunctionMetadata): IRawFunction;
interface ForgeScriptLike {
    FunctionManager: {
        raw: IRawFunction[];
        get?(name: string): {
            data: {
                args?: IParam[];
                unwrap?: boolean;
                deprecated?: boolean;
            };
        } | undefined;
    };
}
/** `FunctionManager.raw`, with each function's documented arguments from its definition. */
export declare function withParams(forgescript: ForgeScriptLike): IRawFunction[];
/** How a function is written with its arguments: `$sendMessage[channel ID;content?;return message ID?]`. */
export declare function usage(fn: IRawFunction): string;
export {};
//# sourceMappingURL=table.d.ts.map