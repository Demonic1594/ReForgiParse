# Changelog

## 0.5.0

- **`reforgiparse --lsp`**, a language server for any editor that speaks the protocol, with no dependencies: diagnostics as you type (the command line's, with the config and directives), quick fixes for a name's letter case, for escaping brackets (marked as changing what the bot sends) and for turning a rule off for a line, and "fix all". The line directive is `$c[...]` at the end of a code line, offered only when the code then does the same apart from it, or a JavaScript comment above other lines. Functions, config and custom functions are read again on save; a broken config is shown to the user.
- **`reforgiparse/core`**: `checkScript(text, table, options)`, the checks on one file's text with no file access and no ForgeScript needed, for editor extensions and browsers. The command line and the server use it.
- Found by the new tests: messages the server sent while loading the bot went to stderr instead of the editor, because ForgeScript's output is redirected then. The protocol now always writes to the original stdout.

## 0.4.1

- **`--reindent`**, opt-in: indents lines that start with a function, `;` or `]` by nesting depth. Lines that start with text and blank lines stay as written, and so does every line of an argument that also has text (that whitespace is sent with the words) and every line inside a condition (whitespace there is compared: `$if[` then `1==1` on an indented line is false). The result must parse the same apart from that whitespace. The config's `indent` sets spaces per level, or `"tab"`.
- Checked on 16 example bots: every code string compiles the same on ForgeScript apart from indentation, and a poll's list of options is no longer shifted.

## 0.4.0

- **Renamed to ReForgiParse**, after the repository: package `reforgiparse`, command `npx reforgiparse`, `REFORGIPARSE_CORPUS` for the parity corpus. (0.1.0 to 0.3.1 were called ForgeParse.)
- **`--fix`**: function names in their declared letter case. Only edits that cannot change the bot: each is checked by parsing the code before and after and kept only if both give the same functions, arguments and errors. Names written with escapes in the file are left alone and reported. Whitespace is never touched, since ForgeScript sends it.
- **`--fix-brackets`**: escapes a `[` in an argument's text and the `]` that closed the function too early, so ForgeScript prints the text as written. Made only when it removes the problem and adds no compile error.
- **Config**: `reforgiparse.config.json`, or `"reforgiparse"` in package.json, with `rules`, `include`, `exclude`, `properties` and `known`. JSON, so no code from the config runs. Any mistake in it stops the check with exit code 2 and says what is wrong.
- **Directives**: `$c[reforgiparse-disable-next-line ...]`, `-disable-line`, `-disable` / `-enable`, also as JavaScript comments; ForgeLint's `forgelint-` directives are read the same way. A misspelt rule in one is reported (`unknown-rule`).
- Tests: config, directives and fixes on real bots in temporary folders; `--fix` checked against ForgeScript's compiler, `--fix-brackets` and `$c[...]` against its interpreter.

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
