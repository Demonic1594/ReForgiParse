/** One argument as the compiler sees it. */
export interface IRawField {
    /** The field is a condition (`$if[a==b;...]`): an operator splits it in two. */
    condition?: boolean;
    /** The field takes every remaining argument. */
    rest?: boolean;
}
/** A function as ForgeScript's compiler sees it (the shape of `FunctionManager.raw`). */
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
    static fromForgeScript(forgescript?: {
        FunctionManager: {
            raw: IRawFunction[];
        };
    }): FunctionTable;
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
        condition?: boolean;
        rest?: boolean;
    }> | null;
}
/** One metadata entry as the compiler sees it. */
export declare function fromMetadata(m: IFunctionMetadata): IRawFunction;
//# sourceMappingURL=table.d.ts.map