# Changelog

## 0.2.0

- `npx forgeparse`: checks a whole bot. Reads the `code:` strings in its JavaScript and TypeScript files exactly as JavaScript does, knows the installed ForgeScript, every installed extension (from its metadata, or from its `NativeFunction` files when it has none) and the bot's custom functions, and reports problems at their line and column, as text or JSON, with exit code 1 on errors.
- Rules: `missing-brackets`, `too-many-arguments`, `unclosed-bracket`, `too-few-arguments`, `unknown-event`, `unexpected-brackets`, `unknown-function` (with the closest name), `glued-name`, `unreadable-string`. Errors show the function's usage.
- API: `Project`, `checkCode`, `extractCode`, `readNatives`, `usage`, `suggest`. `CompileError` gains `start`, `end` (the part of the code it is about) and `fn`; `IRawFunction` gains `params`, `unwrap` and `deprecated`.
- `nameIssues` no longer reports `$` followed by a digit (`$5`).

## 0.1.0

- The parser: the same tree and compile errors as ForgeScript's compiler, with source positions and error recovery. `FunctionTable`, `parse`, `render`, `walk`, `nameIssues`.
