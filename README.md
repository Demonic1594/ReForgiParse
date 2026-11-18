# ForgeParse

A parser for [ForgeScript](https://github.com/tryforge/ForgeScript) that gives the same result as ForgeScript's own compiler, plus what tools need and the compiler does not give: where everything is in the source, every error instead of only the first, and names that do not run as written.

> **Status: 0.2.0.** The parser, a check of a whole bot from the command line, and the rules below are done and tested. Coming next: argument types and enum values, unused variables, deprecated functions, a formatter, a config file and editor support. The API may still change before 1.0.

## Contents

1. [Why ForgeParse](#why-forgeparse)
2. [Installation](#installation)
3. [Checking a bot](#checking-a-bot)
4. [Rules](#rules)
5. [Using the parser](#using-the-parser)
6. [What you get](#what-you-get)
7. [How it is tested](#how-it-is-tested)
8. [Licence](#licence)

## Why ForgeParse

- **It agrees with ForgeScript.** The parser follows ForgeScript's compiler step by step, so the tree, the numbering of calls, the condition operators, the template and the compile errors (message, line and column) are the ones ForgeScript produces, quirks included: `$pingms` runs `$ping` and prints `ms`, a `[` after a function that takes no arguments is text, `\` before `$` stops a call. Every test compares it with the real compiler.
- **It keeps going.** With `recover: true` it reports every compile error and still gives a tree, so an editor or a linter can show all problems at once. Without errors, the tree is the same as in strict mode.
- **It knows where everything is.** Every call, name, bracket, separator, argument and operator has its offset in the source.
- **It reports names that do not run as written.** `nameIssues` finds `$words` that are printed as text and names that a shorter function swallows.
- **No dependencies.** ForgeScript is only needed to read the function list from an installed copy; the list can also come from metadata files.

## Installation

```bash
npm i -D github:Demonic1594/ReForgiParse
```

Node.js 18.17 or newer. ForgeScript 2.5.0 or newer is an optional peer: needed for `FunctionTable.fromForgeScript` and to check a bot.

## Checking a bot

Run it in the bot's folder:

```bash
npx forgeparse                       # the whole bot
npx forgeparse commands/daily.js     # some files (custom functions are still read from the whole bot)
npx forgeparse --json                # for other tools
```

```
commands/a.js:6:1  error    Function $sendMessage requires brackets. Usage: $sendMessage[channel ID;content?;return message ID?]  [missing-brackets]
commands/a.js:9:41  warning  $authorI runs $author and prints "I" after it.  [glued-name]
commands/a.js:16:11  error    "messageCreat" is not an event of ForgeScript or its extensions here, so this command never runs. Did you mean "messageCreate"?  [unknown-event]

2 error(s), 1 warning(s) in 4 file(s) under . (functions: @tryforge/forgescript 2.8.0, custom)
```

The exit code is 1 when there are errors, so it can run in CI. `--no-warnings` reports errors only, `--quiet` prints nothing when all is well, and `--property <name>` reads another property as code besides `code`.

**What it reads:**

- **Code:** the `code:` strings in `.js`, `.ts`, `.cjs`, `.mjs`, `.cts` and `.mts` files, read exactly as JavaScript reads them (escapes, template literals), with every character mapped back to its line and column. It skips `node_modules`, folders starting with a dot, and `dist`, `build`, `docs`, `coverage` and `out` at the top. `${...}` parts are only known when the bot runs, so a name right before one is not reported.
- **Functions:** the bot's installed ForgeScript, and every installed dependency that uses ForgeScript. Extensions come first, as in a bot: an extension's function replaces ForgeScript's of the same name. An extension's `metadata/functions.json` is used when it has one. Otherwise (the official extensions on npm) its `NativeFunction` files are loaded without starting the extension: nothing connects to a database or to Discord.
- **Custom functions:** `{ name, params, code }` objects anywhere in the bot, and every `{ name, code }` in a `functions` folder. As in ForgeScript, a custom function without `params` takes no arguments.
- **Events:** ForgeScript's and its extensions', for a command's `type`.

## Rules

| Rule | Severity | What ForgeScript does |
|---|---|---|
| `missing-brackets` | error | `$get` without brackets: ForgeScript refuses to compile the code. |
| `too-many-arguments` | error | `$get[a;b]`: ForgeScript refuses to compile the code. |
| `unclosed-bracket` | error | `$get[a` without `]`: ForgeScript refuses to compile the code. |
| `too-few-arguments` | error | `$addField[Coins]`: the command stops with "missing argument" when it gets there. Only for functions whose arguments ForgeScript reads itself; `$if` and the like read their own. |
| `unknown-event` | error | `type: "messageCreat"`: the command never runs. Application commands (with `data`) are not checked. |
| `unexpected-brackets` | warning | `$ping[x]`: `$ping` takes no arguments, so `[x]` is printed. |
| `unknown-function` | warning | `$sendMesage`: no such function here, so it is printed as text. Suggests the closest name. `$5` is not reported. |
| `glued-name` | warning | `$pingms`: `$ping` runs and `ms` is printed. Often meant. |
| `unreadable-string` | warning | A `code:` string that does not end where JavaScript would end it: it is not checked. |

Compile errors and `too-few-arguments` show the function's usage.

## Using the parser

```js
const { FunctionManager } = require("@tryforge/forgescript")
const { FunctionTable, parse, nameIssues, walk } = require("forgeparse")

FunctionManager.loadNative()                         // a running bot has already loaded its functions
const table = FunctionTable.fromForgeScript()

const result = parse("$if[$get[a]==1;Pong! $pingms;no]", table)
result.functions[0].fields[0]                        // { kind: "condition", op: "==", lhs, rhs, ... }

parse("$get[a", table)                               // throws CompileError "Function $get is missing brace closure", line 1, column 6
parse("$sendMessage $get[a", table, { recover: true }).errors.map((e) => e.kind)
// ["requires-brackets", "missing-closure"]

nameIssues("Pong! $pingms", table)
// [{ kind: "glued", written: "$pingms", runs: "$ping", rest: "ms", start: 6, end: 13 }]
```

The function list can also come from extensions' `metadata/functions.json`, extensions first, as in a bot:

```js
const reforgeDB = require("@tryforge/reforge.db/metadata/functions.json")
const table = FunctionTable.fromMetadata(reforgeDB, forgeScriptMetadata)  // forgeScriptMetadata: the same format, for ForgeScript's functions
```

## What you get

| | Meaning |
|---|---|
| `parse(code, table, { recover })` | `{ source, code, functions, errors }`. `code` is the top level as a template with `[SYSTEM_FUNCTION(n)]` placeholders, as ForgeScript has it. |
| `Call` | `name` (as registered), `written`, `index` (ForgeScript's number: inner calls first), `negated` (`$!`), `silent` (`$#`), `count` (`$@[...]`), `fields` (`null` without brackets), and the offsets `start`, `nameStart`, `nameEnd`, `open`, `close`, `separators`, `end`. |
| `Field` | `value` (with placeholders), `raw` (as written, escapes resolved), `functions`, `start`, `end`. |
| `ConditionField` | `op` (`==` `!=` `<=` `>=` `<` `>`, or `unknown` without one), `lhs`, `rhs`, `opStart`. |
| `CompileError` | `message`, `line` (1-based), `column` (0-based, UTF-16), `offset` and `kind`: `requires-brackets`, `too-many-args` or `missing-closure`. `line`, `column` and `offset` are ForgeScript's, which can be one or two past the end of the source after a trailing `\`; positions in the tree never are. |
| `render(template, values)` | Fills placeholders in order and drops backslashes before them, as ForgeScript builds a command's text. |
| `walk(calls)` | Every call, outer before inner. |
| `nameIssues(code, table)` | `unknown` (printed as text) and `glued` (`runs` and `rest`) names. |
| `checkCode(code, table)` | The [rules](#rules) on one string of code: `{ rule, severity, message, start, end }`. |
| `Project.load(folder).check()` | The rules on a whole bot: `{ file, line, column, endLine, endColumn, severity, rule, message }`. |
| `extractCode(text)` | The `code:` strings in a JavaScript or TypeScript file, as ForgeScript receives them, with each character's offset in the file. |

Offsets are UTF-16 indexes, like JavaScript string indexes.

## How it is tested

`npm test` runs these checks:

- **Parity with ForgeScript's compiler** (the one in the installed `@tryforge/forgescript`, given the same function list): a hand-written set covering the grammar, and 20,000 random inputs built from ForgeScript's syntax and every kind of function (no brackets, optional, required, conditions, rest arguments, aliases, `!`, `#`, `@[...]`, escapes, newlines, non-BMP characters). Tree, template and errors must be identical. `FORGEPARSE_CORPUS=<folder>` adds every ForgeScript block and `code:` string in the `.md`, `.js` and `.fsx` files under it; `FUZZ_RUNS` and `FUZZ_SEED` change the random inputs.
- **Positions**: every offset points at the character it names, on the same inputs.
- **Recovery**: without errors the tree equals strict mode's; with errors the first is the one ForgeScript throws.
- **Reading files**: 15,000 random JavaScript string and template literals (every escape, line continuations, CRLF) read by ForgeParse and evaluated by Node must be equal; comments and other properties are skipped; positions map to the right line and column.
- **A whole bot** (`test/fixtures/bot`): every problem found once, at the right line and column; clean code gets nothing; custom functions with and without `params`; the command line's output and exit codes; an extension without metadata read from its `NativeFunction` files.

Each check was confirmed to fail when the parser is broken on purpose (wrong column counting, escapes that do not stop a call, a missing "requires brackets" error).

Also run by hand, not in CI:

- 6,931 ForgeScript snippets from a knowledge base and 168 from 16 example bots, with ForgeScript 2.8.0 and four extensions loaded (1,955 function names): no difference from ForgeScript's compiler.
- `npx forgeparse` on those 16 bots, which all pass their tests, with their extensions installed (ForgeDB, ForgeGiveaways, ForgeMusic, ForgeLinked and the four ReForge extensions): no errors and no warnings.

## Licence

LGPL-3.0-or-later (`COPYING.LESSER`, with the GPL it extends in `COPYING`), like ForgeScript, whose compiler it reproduces. ForgeParse is not affiliated with BotForge.
