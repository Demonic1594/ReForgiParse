# ReForgiParse

Static analysis for [ForgeScript](https://github.com/tryforge/ForgeScript) bots, built on a parser that matches ForgeScript's own compiler.

ReForgiParse checks the ForgeScript code in a bot's source files and reports code that will not compile, arguments ForgeScript will reject, names it will print as text, and code that runs differently from how it reads. Every finding describes what ForgeScript actually does with the code.

## Contents

- [Features](#features)
- [Installation](#installation)
- [Usage](#usage)
- [Rules](#rules)
- [Fixes](#fixes)
- [Configuration](#configuration)
- [Inline directives](#inline-directives)
- [Editor integration](#editor-integration)
- [Continuous integration](#continuous-integration)
- [API](#api)
- [Migrating from ForgeLint](#migrating-from-forgelint)
- [Testing](#testing)
- [License](#license)

## Features

- **Compiler-accurate parsing.** Produces the same tree and the same compile errors, at the same line and column, as ForgeScript's compiler.
- **Argument validation by ForgeScript itself.** Numbers, booleans, durations, colours, URLs, permissions and enum values are validated with the resolvers of the ForgeScript version installed in the bot.
- **Project awareness.** Loads ForgeScript, every installed extension and the bot's custom functions, and checks each command's event type.
- **Precise locations.** Findings point to the exact file, line and column, through JavaScript escapes and template literals.
- **Safe fixes.** Automatic fixes are applied only when they cannot change the bot's behaviour; fixes that do are opt-in and labelled.
- **Editor support.** A built-in language server with diagnostics, completion, hover and quick fixes, and an embeddable core.
- **No runtime dependencies.**

## Installation

```bash
npm install --save-dev github:Demonic1594/ReForgiParse
```

Requires Node.js 18.17 or later and `@tryforge/forgescript` 2.5.0 or later installed in the bot.

## Usage

Run in the bot's root folder:

```bash
npx reforgiparse                     # check the whole bot
npx reforgiparse commands            # check a folder of the bot
npx reforgiparse commands/daily.js   # check specific files
npx reforgiparse --fix               # apply safe fixes, then check
```

A folder or file is always checked as part of its bot (the nearest folder above it with a `package.json`), so the bot's custom functions, extensions and configuration apply. A path that does not exist, or is not a JavaScript or TypeScript file, is reported as an error.

Given this command:

```js
module.exports = {
    name: "shop",
    type: "messageCreate",
    code: `$addActionRow
$addButton[buy;Buy;primary]
$title[Shop]
$color[blue]
$description[You have $getUserVar[coins] coins]
$sendMesage[$channelID;Done]`
}
```

ReForgiParse reports:

```
commands/shop.js:5:20  error    $addButton: "style" must be Primary (letter case matters), not "primary". ForgeScript stops the command: "Given value primary for argument style is not of type Enum"  [invalid-argument]
commands/shop.js:7:8   warning  $color: "blue" is not a colour name, so it is read as hexadecimal up to its first non-hex letter: #00000b. Write Blue  [color-value]
commands/shop.js:9:1   warning  $sendMesage is not a function here, so ForgeScript prints it as text. Did you mean $sendMessage?  [unknown-function]

1 error, 2 warnings in 1 file
Functions from @tryforge/forge.db 2.1.1, @tryforge/forgescript 2.8.0.
```

### Options

| Option | Description |
|---|---|
| `--format <text\|json\|github>` | Output format. `github` emits GitHub Actions annotations. `--json` is shorthand for `--format json`. |
| `--fix` | Apply fixes that cannot change the bot's behaviour, then check. |
| `--fix-brackets` | Also escape brackets that close a function early. Changes the bot's output. |
| `--reindent` | Re-indent code by nesting depth. See [Fixes](#fixes). |
| `--config <file>` | Use a specific configuration file. |
| `--property <name>` | Also treat this property as code, in addition to `code`. Repeatable. |
| `--max-warnings <n>` | Exit with code 1 when there are more than `n` warnings. |
| `--no-warnings` | Report errors only. |
| `--no-info` | Omit informational findings. |
| `--quiet` | Print nothing when there are no findings. |
| `--rules` | List all rules. |
| `--lsp` | Start the language server. |

Options that take a value also accept `--option=value`.

Exit codes: `0` no errors, `1` errors found (or more warnings than `--max-warnings`), `2` invalid usage or configuration.

Colours are used on a terminal. Set `NO_COLOR` to turn them off, or `FORCE_COLOR=1` to keep them in CI logs.

### What is checked

- **Code:** string values of the `code` property (quoted or not) in `.js`, `.ts`, `.cjs`, `.mjs`, `.cts` and `.mts` files, read as JavaScript reads them. `node_modules`, hidden folders, and top-level `dist`, `build`, `docs`, `coverage` and `out` are skipped.
- **Functions:** ForgeScript and every installed package that depends on it, in the order a bot loads them. Extensions without `metadata/functions.json` are read from their function files without being started.
- **Custom functions:** `{ name, params, code }` objects anywhere in the bot, and every `{ name, code }` in a `functions` folder.
- **Events:** each command's `type` against the events of ForgeScript and its extensions.

## Rules

Each finding states what ForgeScript does with the code. Some consequences:

- **One mistake gives one finding.** A misspelt name in an argument is reported as the name, not also as an invalid value. A `]` left over by an unescaped `[` belongs to that `unescaped-bracket` finding.
- **Only the first rejected argument is reported.** ForgeScript reads a call's arguments in order and stops the command at the first it rejects.
- **Code that does not compile gets compile errors only.** No argument values, variables or brackets are checked inside a call that does not compile.
- **Code inside `$escapeCode[...]` is printed, not run.** Only compile errors and bracket problems apply to it.

### Errors

| Rule | Example | Effect |
|---|---|---|
| `missing-brackets` | `$get` | The code does not compile. |
| `too-many-arguments` | `$get[a;b]` | The code does not compile. |
| `unclosed-bracket` | `$get[a` | The code does not compile. |
| `too-few-arguments` | `$addField[Coins]` | The command stops with an error. |
| `invalid-argument` | `$round[abc]`, `$wait[1.5h]` | The command stops with an error. |
| `unknown-event` | `type: "messageCreat"` | The command never runs. |

### Warnings

| Rule | Example | Effect |
|---|---|---|
| `unknown-function` | `$sendMesage[...]` | Printed as text. |
| `glued-name` | `$pingms` | Runs `$ping`, then prints `ms`. |
| `unexpected-brackets` | `$ping[x]` | The brackets and their content are printed. |
| `misplaced-operator` | `$#!ping` | The call is printed as text. |
| `unescaped-bracket` | `$description[[Docs](url)]` | The first `]` closes the function. |
| `stray-bracket` | `$let[a;1]]` | The `]` closes nothing and is printed. |
| `condition-operator` | `$if[a==1&&b==2;...]` | Only the first operator is evaluated. |
| `color-value` | `$color[blue]` | Read as hexadecimal: `#00000b`. |
| `http-url` | `http://...` as a URL argument | Converted to an invalid URL. |
| `unused-variable` | `$let[a;1]` without `$get[a]` | The variable is never read. |
| `unset-variable` | `$get[a]` without `$let[a;...]` | Always empty. |
| `wrong-store` | `$arrayCreate[list;3]$get[list]` | Always empty; use `$env`. |
| `deprecated` | `$createGuild[...]` | Deprecated by its package. |
| `unreadable-string` | an unterminated `code` string | Not checked. |
| `unknown-rule` | a misspelt rule in a directive | The directive has no effect. |

### Info

| Rule | Example | Suggestion |
|---|---|---|
| `hidden-output` | `$let[ok;$pauseTrack]`, never read | Use `$!pauseTrack`. |
| `escaped-letter` | `\n` inside an argument | It is the letter `n`. |
| `function-case` | `$AUTHORID` | Use `$authorID`. |

Run `npx reforgiparse --rules` for descriptions.

## Fixes

| Option | Changes | Behaviour |
|---|---|---|
| `--fix` | Function names to their declared case. | Unchanged. Each edit is verified by re-parsing. |
| `--fix-brackets` | Escapes `[` and `]` in text that would close a function early, including `\[` written in JavaScript (which is a plain `[`). | Changed: the text is printed as written. |
| `--reindent` | Indentation of lines starting with a function, `;` or `]`. | May change output: ForgeScript sends whitespace inside arguments. |

`--fix-brackets` and `--reindent` never modify code that does not compile. `--reindent` also leaves lines inside conditions and lines in an argument that also contains text. The indent size is set by the `indent` option or detected from the code.

## Configuration

ReForgiParse reads `reforgiparse.config.json` from the bot's root folder, or a `"reforgiparse"` key in `package.json`.

```json
{
    "rules": { "function-case": "off", "glued-name": "error" },
    "exclude": ["tests"],
    "known": ["$priceOfTheDay"]
}
```

| Option | Type | Description |
|---|---|---|
| `rules` | object | Severity per rule: `"error"`, `"warning"`, `"info"` or `"off"`. |
| `include` | string[] | Files and folders to check. Default: the whole bot. |
| `exclude` | string[] | File or folder names, or paths, to skip. |
| `properties` | string[] | Properties containing code. Default: `["code"]`. |
| `known` | string[] | Functions created at runtime, never reported as unknown. |
| `indent` | number \| `"tab"` | Indent size for `--reindent`. |

Invalid configuration is reported as an error.

## Inline directives

Disable rules with `$c[...]` inside code:

```
$c[reforgiparse-disable-next-line unknown-function]
$runtimeFunction

$pingms $c[reforgiparse-disable-line glued-name]

$c[reforgiparse-disable]
...
$c[reforgiparse-enable]
```

or with JavaScript comments:

```js
// reforgiparse-disable-next-line invalid-argument
module.exports = { name: "x", type: "messageCreate", code: "$round[abc]" }
```

A directive without rule names applies to all rules. Separate several rule names with spaces or commas.

## Editor integration

### Language server

`reforgiparse --lsp` starts a Language Server Protocol server on standard input and output. Inside code strings it provides:

- diagnostics as you type, with the bot's configuration and directives;
- completion of function names after `$`, from ForgeScript, the bot's extensions and its custom functions;
- hover with a function's usage, description, arguments, output and package;
- quick fixes (letter case, brackets, disabling a rule for a line) and a fix-all action.

**Neovim** (0.11+):

```lua
vim.lsp.config("reforgiparse", {
    cmd = { "npx", "reforgiparse", "--lsp" },
    filetypes = { "javascript", "typescript" },
    root_markers = { "package.json" },
})
vim.lsp.enable("reforgiparse")
```

**Helix** (`languages.toml`):

```toml
[language-server.reforgiparse]
command = "npx"
args = ["reforgiparse", "--lsp"]

[[language]]
name = "javascript"
language-servers = ["typescript-language-server", "reforgiparse"]
```

In VS Code, [ForgeVSC](https://github.com/tryforge/ForgeVSC) provides completion, hover and highlighting.

### Embedding

`reforgiparse/core` runs the checks on a single file's text, without file system access or ForgeScript, for editor extensions and browsers:

```js
const { checkScript, FunctionTable } = require("reforgiparse/core")

const table = FunctionTable.fromMetadata(functions) // metadata/functions.json format
const diagnostics = checkScript(text, table, { events, rules })
```

Argument values are validated when a `ValueChecker` is passed as `values`.

## Continuous integration

```yaml
- run: npm ci
- run: npx reforgiparse --format github
```

Findings appear as annotations on pull requests; errors fail the job. Add `--max-warnings 0` to fail on warnings as well.

## API

```js
const { FunctionTable, parse, checkCode, Project } = require("reforgiparse")

const table = FunctionTable.fromForgeScript() // the installed ForgeScript's functions

parse("$if[$get[a]==1;yes;no]", table)                 // parse tree
parse("$get[a", table)                                 // throws CompileError at line 1, column 6
parse("$sendMessage $get[a", table, { recover: true }) // all errors, and a tree

checkCode("$round[abc]", table)                        // findings for a code string
Project.load("./bot").check()                          // findings for a whole bot
```

| Export | Description |
|---|---|
| `parse(code, table, { recover })` | Parses code as ForgeScript's compiler does. Returns `{ source, code, functions, errors }`. |
| `checkCode(code, table, options)` | Findings for one code string. |
| `checkScript(text, table, options)` | Findings for one source file's text. |
| `Project.load(folder).check()` | Findings for a whole bot, with file positions. |
| `fixText(text, table, options)` | Applies fixes to a source file's text. |
| `extractCode(text)` | Code strings in a source file, with their positions. |
| `FunctionTable` | Function list: `fromForgeScript()`, `fromMetadata(...)`, `get(name)`, `functions`. |
| `loadConfig`, `directivesIn`, `nameIssues`, `render`, `walk`, `usage`, `suggest` | Utilities. |

Positions are UTF-16 offsets, as in JavaScript strings.

## Migrating from ForgeLint

- `forgelint-` directives are recognised, so existing directives keep working.
- Rules shared with ForgeLint use the same names.
- Configuration is JSON (`reforgiparse.config.json`) instead of JavaScript.
- `--reindent` is opt-in and skips lines where indentation would change output.

## Testing

Parsing is verified against ForgeScript's compiler on hand-written cases and 20,000 generated inputs. Rule behaviour is verified against ForgeScript's interpreter wherever it can run without Discord. The suite runs on Node.js 22 and 24 with ForgeScript 2.8.0 and 2.5.0, and CI installs the packed package into an empty bot and runs it. See [CONTRIBUTING.md](CONTRIBUTING.md).

```bash
npm test
npm run parity
```

## License

[LGPL-3.0-or-later](COPYING.LESSER)
