/** Runs a language server on the given streams (stdin and stdout by default) until `exit`. */
export declare function serve(input?: NodeJS.ReadableStream, output?: NodeJS.WritableStream): void;
/** LSP position (0-based line, UTF-16 character) to a text offset. */
export declare function offsetAt(text: string, pos: {
    line: number;
    character: number;
}): number;
/** A text offset to an LSP position. */
export declare function positionAt(text: string, offset: number): {
    line: number;
    character: number;
};
//# sourceMappingURL=lsp.d.ts.map