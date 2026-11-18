# Changelog

All notable changes to this project are documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Until 1.0, minor versions may change the API.

## 0.7.0 - 2026-11-18

### Added

- `stray-bracket` warning: a `]` outside any function that no `[` opened, which ForgeScript prints (`$let[a;1]]` sends `]`). Balanced brackets in text, such as `Page [1/3]`, are not reported.

### Changed

- One mistake gives one finding:
  - a misspelt name in an argument is not also reported as an invalid argument value;
  - in a call that does not compile, its arguments are not checked for values or count;
  - the `]` left over by an unescaped `[` belongs to that `unescaped-bracket` finding;
  - a `$let` with an empty name is not reported as an unused variable.
- Only the first argument ForgeScript rejects in a call is reported (`invalid-argument` or `too-few-arguments`): ForgeScript stops the command there and never reads the others.
- Code inside `$escapeCode[...]` is printed, never run: only compile errors and bracket problems are reported in it, and its `$let` and `$get` count for no variable.
- Variable rules stand down for code that calls `$coroutine`, which runs its code in another thread.
- `FunctionTable.fromForgeScript()` loads ForgeScript's functions when none are registered yet, so a script no longer needs `FunctionManager.loadNative()` first.
- `--reindent` says why it leaves code whose lines are `\n` escapes in a JavaScript string.
- Checking is linear in the size of a file: an 84 kB code string takes about 50 ms instead of 0.7 s. `--fix-brackets` fixes a whole code string in one pass: 84 kB takes 0.2 s instead of 13 s.

### Fixed

- A file ending inside an unclosed `/*` comment made the check loop without end until memory ran out, in the command line and in the language server while a comment was being typed.
- `--fix` changed the letter case of names inside `$escapeCode[...]`, which prints its code as written, so the bot's output changed.
- `--fix-brackets` stopped after 500 fixes in a file.
- The language server registered ForgeScript's functions again on every save, and ForgeScript logged a warning each time.

## 0.6.0 - 2026-11-18

### Added

- Language server: completion of function names after `$` in code strings, from ForgeScript, the bot's extensions and its custom functions, and hover with a function's usage, description, arguments, output and package.
- `--max-warnings <n>` option: exit with code 1 when there are more than `n` warnings. With `--format github`, the failure is also reported as an annotation.
- Options that take a value accept `--option=value`. An unknown option suggests the closest one.
- `FORCE_COLOR` keeps colours when the output is not a terminal, for CI logs.
- `--fix-brackets` also escapes brackets written as `\[` and `\]` in JavaScript, which reach ForgeScript as plain brackets.
- Type declarations for `reforgiparse/core` under TypeScript's `node10` module resolution, the default for `"module": "commonjs"`.
- API: `FunctionTable.functions`; `description` and `output` on `IRawFunction`.

### Changed

- A folder or file given on the command line is checked as part of its bot (the nearest folder above it with a `package.json`), so the bot's custom functions, extensions and configuration apply, and paths are reported from the bot's folder.
- A name that compiles only as a shorter function needing brackets, such as `$authorI`, is one `missing-brackets` error that names the likely function (`$authorID`), instead of an error and a `glued-name` warning.
- `invalid-argument` describes an empty argument as empty.
- The summary uses singular and plural forms and lists the function sources on a line of its own. Locations are aligned within each file.
- Usage and configuration errors start with `reforgiparse:` and give paths relative to the current folder.
- The JSON output's `functions` counts functions, not names and aliases.
- The published package no longer contains source maps.

### Fixed

- `code` properties with quoted names (`"code": "..."`) were not checked.
- A regular expression literal containing a quote or a backtick could stop the rest of the file from being read.
- A path that does not exist, or a file that is not JavaScript or TypeScript, was checked as nothing and passed with exit code 0. It is now a usage error (exit code 2).
- Installed in a bot, ReForgiParse read itself as a ForgeScript extension and printed a note on every run.
- `unescaped-bracket` was reported, and `--fix-brackets` escaped brackets, inside calls that contain a compile error, where ForgeScript compiles nothing and the brackets' meaning is unknown. Those calls are skipped.
- A misspelt rule name in the configuration was reported as `config: config:` instead of with the configuration file's path.

## 0.5.0 - 2026-11-18

### Added

- Language server, started with `reforgiparse --lsp`, for editors that support the Language Server Protocol. It reports the same findings as the command line while you edit, applies the configuration and inline directives, and provides:
  - quick fixes for function name case and for unescaped brackets (the latter labelled as changing the bot's output);
  - a quick fix that disables a rule for one line, written as `$c[...]` inside code or as a JavaScript comment elsewhere, and offered only when it leaves the compiled code unchanged;
  - a fix-all action for function name case.

  Functions, configuration and custom functions are reloaded when a file is saved. Configuration errors are shown in the editor.
- `reforgiparse/core` entry point, exporting `checkScript(text, table, options)`. It checks one file's text without file system access or ForgeScript, for use in editor extensions and browsers.

### Changed

- The command line and the language server both run their checks through `checkScript`, so their findings are identical.

## 0.4.1 - 2026-11-18

### Added

- `--reindent` option, which indents lines starting with a function, `;` or `]` by nesting depth. ForgeScript sends whitespace inside arguments and compares it inside conditions, so the following are left unchanged:
  - lines that start with text, and blank lines;
  - every line of an argument that also contains text;
  - every line inside a condition.

  A re-indented code string is kept only if it compiles to the same result apart from indentation.
- `indent` configuration option: the number of spaces per level (1 to 8) or `"tab"`. When it is not set, the indentation is detected from the code.

## 0.4.0 - 2026-11-18

### Added

- `--fix` option, which rewrites function names in their declared letter case. An edit is kept only if the code parses to the same functions, arguments and errors before and after it. Names written with JavaScript escapes are reported but not changed, and whitespace is never modified.
- `--fix-brackets` option, which escapes a `[` in argument text and the `]` that would close the function early, so ForgeScript prints the text as written. It is applied only when it resolves the finding without introducing a compile error. This fix changes the bot's output.
- Configuration through `reforgiparse.config.json` or a `"reforgiparse"` key in `package.json`, with the options `rules`, `include`, `exclude`, `properties` and `known`. Configuration is plain JSON and is never executed. Invalid configuration stops the check with exit code 2 and a description of the problem.
- Inline directives `reforgiparse-disable-next-line`, `reforgiparse-disable-line`, `reforgiparse-disable` and `reforgiparse-enable`, in `$c[...]` or in JavaScript comments. ForgeLint's `forgelint-` directives are recognised as well.
- `unknown-rule` warning for directives that name a rule that does not exist.

### Changed

- Renamed from ForgeParse to ReForgiParse. The package is now `reforgiparse`, the command is `npx reforgiparse`, and the parity corpus variable is `REFORGIPARSE_CORPUS`. Versions 0.1.0 to 0.3.1 were released as ForgeParse.

## 0.3.1 - 2026-11-18

### Added

- Contribution guidelines in `CONTRIBUTING.md`.

### Changed

- `too-few-arguments` and `invalid-argument` messages quote the error ForgeScript reports, for example `Function $addField is missing argument value` and `Given value abc for argument number is not of type Number`.

### Fixed

- `color-value` described an unreadable colour as invalid. It now states that the embed receives no colour, which is what ForgeScript does.

## 0.3.0 - 2026-11-18

### Added

- Argument validation with the resolvers of the ForgeScript version installed in the bot:
  - `invalid-argument`: numbers, booleans, durations, enum values (with a hint when only the letter case differs), permissions and IDs;
  - `color-value`: colours that ForgeScript accepts but reads differently than intended, such as `$color[blue]` (read as `#00000b`) and `$color[123456]` (read as a decimal number);
  - `http-url`: `http://` URLs, which ForgeScript converts into an invalid URL.
- Variable rules: `unused-variable`, `unset-variable`, and `wrong-store` for a value read from a different store than the one it was written to (for example `$get` on an array created with `$arrayCreate`, which only `$env` reads). Which store each function uses is read from its source. These rules are skipped for code that calls a function whose store usage cannot be determined, and for code that does not compile.
- `hidden-output`: a `$let` whose variable is never read, used only to hide a function's output. `$!` does this directly.
- `condition-operator`: conditions with more than one operator, with `&&` or `||`, or with no operator.
- `unescaped-bracket`, `misplaced-operator` (such as `$#!ping`) and `escaped-letter` (such as `\n` inside an argument).
- `deprecated` and `function-case`.
- `info` severity, alongside `error` and `warning`.
- Command-line options `--format github` (GitHub Actions annotations), `--no-info` and `--rules`.
- API: `ValueChecker`, `Rules` and `distance`. `IParam` gains `type` and `enum`; `IRawFunction` gains `package` and `stores`.

### Changed

- Terminal output is coloured and grouped by file.
- Argument findings state what the argument must be.

## 0.2.0 - 2026-11-18

### Added

- Command line (`npx forgeparse`) that checks a whole bot. It:
  - reads `code` strings from JavaScript and TypeScript files, decoding escapes and template literals as JavaScript does;
  - loads the installed ForgeScript, every installed extension (from its metadata, or from its function files when it has none) and the bot's custom functions;
  - reports findings by file, line and column, as text or JSON;
  - exits with code 1 when errors are found.
- Rules: `missing-brackets`, `too-many-arguments`, `unclosed-bracket`, `too-few-arguments`, `unknown-event`, `unexpected-brackets`, `unknown-function` (with the closest matching name), `glued-name` and `unreadable-string`. Error messages include the function's usage.
- API: `Project`, `checkCode`, `extractCode`, `readNatives`, `usage` and `suggest`. `CompileError` gains `start`, `end` and `fn`; `IRawFunction` gains `params`, `unwrap` and `deprecated`.

### Fixed

- `nameIssues` reported `$` followed by a digit (such as `$5`), which ForgeScript treats as text.

## 0.1.0 - 2026-11-18

### Added

- Parser that produces the same tree and compile errors as ForgeScript's compiler, with source positions and error recovery.
- API: `FunctionTable`, `parse`, `render`, `walk` and `nameIssues`.
