# ForgeParse

A parser for [ForgeScript](https://github.com/tryforge/ForgeScript) that gives the same result as ForgeScript's own compiler, plus what tools need and the compiler does not give: where everything is in the source, every error instead of only the first, and names that do not run as written.

> **Status: 0.1.0, first working version.** The parser, error recovery, positions and the name check are done and tested. Not done yet: a command-line tool, reading a whole bot, argument types and lint rules. The API may still change before 1.0.

## Contents

1. [Why ForgeParse](#why-forgeparse)
2. [Installation](#installation)
3. [Usage](#usage)
4. [What you get](#what-you-get)
5. [How it is tested](#how-it-is-tested)
6. [Licence](#licence)

## Why ForgeParse

- **It agrees with ForgeScript.** The parser follows ForgeScript's compiler step by step, so the tree, the numbering of calls, the condition operators, the template and the compile errors (message, line and column) are the ones ForgeScript produces, quirks included: `$pingms` runs `$ping` and prints `ms`, a `[` after a function that takes no arguments is text, `\` before `$` stops a call. Every test compares it with the real compiler.
- **It keeps going.** With `recover: true` it reports every compile error and still gives a tree, so an editor or a linter can show all problems at once. Without errors, the tree is the same as in strict mode.
- **It knows where everything is.** Every call, name, bracket, separator, argument and operator has its offset in the source.
- **It reports names that do not run as written.** `nameIssues` finds `$words` that are printed as text and names that a shorter function swallows.
- **No dependencies.** ForgeScript is only needed to read the function list from an installed copy; the list can also come from metadata files.

## Installation

```bash
npm i github:Demonic1594/ForgeParse
```

Node.js 18.17 or newer. ForgeScript 2.5.0 or newer is an optional peer: needed for `FunctionTable.fromForgeScript`.

## Usage

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

Offsets are UTF-16 indexes, like JavaScript string indexes.

## How it is tested

`npm test` runs three kinds of check:

- **Parity with ForgeScript's compiler** (the one in the installed `@tryforge/forgescript`, given the same function list): a hand-written set covering the grammar, and 20,000 random inputs built from ForgeScript's syntax and every kind of function (no brackets, optional, required, conditions, rest arguments, aliases, `!`, `#`, `@[...]`, escapes, newlines, non-BMP characters). Tree, template and errors must be identical. `FORGEPARSE_CORPUS=<folder>` adds every ForgeScript block and `code:` string in the `.md`, `.js` and `.fsx` files under it; `FUZZ_RUNS` and `FUZZ_SEED` change the random inputs.
- **Positions**: every offset points at the character it names, on the same inputs.
- **Recovery**: without errors the tree equals strict mode's; with errors the first is the one ForgeScript throws.

Each check was confirmed to fail when the parser is broken on purpose (wrong column counting, escapes that do not stop a call, a missing "requires brackets" error).

Also run once by hand, not in CI: 6,931 ForgeScript snippets from a knowledge base and 168 from 16 example bots, with ForgeScript 2.8.0 and four extensions loaded (1,955 function names): no difference from ForgeScript's compiler.

## Licence

LGPL-3.0-or-later (`COPYING.LESSER`, with the GPL it extends in `COPYING`), like ForgeScript, whose compiler it reproduces. ForgeParse is not affiliated with BotForge.
