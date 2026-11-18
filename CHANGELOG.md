# Changelog

## 0.3.1

- Every rule's claim is now checked by running its example on ForgeScript's real interpreter (`test/runtime.test.js`), on ForgeScript 2.8.0 and 2.5.0.
- That corrected three messages: `too-few-arguments` and `invalid-argument` now quote ForgeScript's actual errors ("Function $addField is missing argument value", "Given value abc for argument number is not of type Number"), and `color-value` says an unreadable colour leaves the embed with none (it was "an invalid colour").
- The rules for contributors moved from `CLAUDE.md` to `CONTRIBUTING.md`.

## 0.3.0

- **Argument values** are checked by the installed ForgeScript's own resolvers: `invalid-argument` (numbers, booleans, durations, enum values with a letter-case hint, permissions, IDs), and two values ForgeScript accepts but misreads: `color-value` (`$color[blue]` is `#00000b`, `$color[123456]` is decimal) and `http-url` (an `http://` link becomes a broken emoji URL).
- **Variables:** `unused-variable`, `unset-variable`, `wrong-store` (`$get` of an array that only `$env` reads, or the reverse), and the hint `hidden-output` (`$let[ok;$fn]` never read: `$!fn` does that). Which functions set or read which store is read from each function's source; the rules stand down when code calls something whose use cannot be seen, and on code that does not compile.
- **Conditions and brackets:** `condition-operator` (a second operator, `&&`/`||`, or no operator), `unescaped-bracket`, `misplaced-operator` (`$#!ping`), `escaped-letter` (`\n` in an argument).
- `deprecated`, and the hint `function-case`. Severities are now error, warning and info.
- Command line: `--format github` (annotations in GitHub Actions), `--no-info`, `--rules`, colours on a terminal, problems grouped by file.
- Clearer messages: an argument problem says what the argument must be.
- Tests: every rule both ways; the fuzzer now makes well-formed nested code half of the time; CI also runs everything on ForgeScript 2.5.0, whose compiler does not record raw field text (only that is not compared there).
- API: `ValueChecker`, `Rules`, `distance`; `IParam` gains `type` and `enum`; `IRawFunction` gains `package` and `stores`.

## 0.2.0

- `npx forgeparse`: checks a whole bot. Reads the `code:` strings in its JavaScript and TypeScript files exactly as JavaScript does, knows the installed ForgeScript, every installed extension (from its metadata, or from its `NativeFunction` files when it has none) and the bot's custom functions, and reports problems at their line and column, as text or JSON, with exit code 1 on errors.
- Rules: `missing-brackets`, `too-many-arguments`, `unclosed-bracket`, `too-few-arguments`, `unknown-event`, `unexpected-brackets`, `unknown-function` (with the closest name), `glued-name`, `unreadable-string`. Errors show the function's usage.
- API: `Project`, `checkCode`, `extractCode`, `readNatives`, `usage`, `suggest`. `CompileError` gains `start`, `end` (the part of the code it is about) and `fn`; `IRawFunction` gains `params`, `unwrap` and `deprecated`.
- `nameIssues` no longer reports `$` followed by a digit (`$5`).

## 0.1.0

- The parser: the same tree and compile errors as ForgeScript's compiler, with source positions and error recovery. `FunctionTable`, `parse`, `render`, `walk`, `nameIssues`.
