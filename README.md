# ReForgiParse

**Find the mistakes in a ForgeScript bot before it runs, the way ForgeScript itself would see them.**

ReForgiParse reads a bot's commands with a parser that gives exactly what ForgeScript's own compiler gives, then checks them with rules that each state what ForgeScript does with the code: refuses to compile it, stops the command, or quietly does something else than what was written.

```bash
npm i -D github:Demonic1594/ReForgiParse
npx reforgiparse
```

For this command:

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

it says:

```
commands/shop.js:5:20  error    $addButton: "style" must be Primary (letter case matters), not "primary". ForgeScript stops the command: "Given value primary for argument style is not of type Enum"  [invalid-argument]
commands/shop.js:7:8  warning  $color: "blue" is not a colour name, so it is read as hexadecimal up to its first non-hex letter: #00000b. Write Blue  [color-value]
commands/shop.js:9:1  warning  $sendMesage is not a function here, so ForgeScript prints it as text. Did you mean $sendMessage?  [unknown-function]

1 error(s), 2 warning(s) in 1 file(s) under . (functions: @tryforge/forge.db 2.1.1, @tryforge/forgescript 2.8.0)
```

> **Status: 0.4.1.** Checks, fixes and parser are tested against ForgeScript 2.8.0 and 2.5.0. Coming next: editor support. The API may change before 1.0.

## Contents

1. [Why ReForgiParse](#why-reforgiparse)
2. [Checking a bot](#checking-a-bot)
3. [Rules](#rules)
4. [Fixing](#fixing)
5. [Config](#config)
6. [Turning rules off in code](#turning-rules-off-in-code)
7. [In CI](#in-ci)
8. [Using the parser](#using-the-parser)
9. [How it is tested](#how-it-is-tested)
10. [Compared with ForgeLint](#compared-with-forgelint)
11. [Licence](#licence)

## Why ReForgiParse

- **It agrees with ForgeScript, by construction.** The parser follows ForgeScript's compiler step by step: the same tree, the same errors at the same line and column, quirks included (`$pingms` runs `$ping` and prints `ms`). Every test run compares it with the real compiler on thousands of inputs.
- **ForgeScript decides what a valid argument is.** Numbers, booleans, durations, colours, links, permissions and enum values are checked by calling the resolvers of the ForgeScript your bot has installed, so a check never disagrees with the version you run. That is how it knows that `$color[blue]` is a near-black `#00000b` and that an `http://` link becomes a broken emoji URL.
- **It knows the whole bot.** ForgeScript, every installed extension (from its metadata, or from its function files when it has none, as the official extensions on npm), your custom functions, and each extension's events.
- **Few false alarms.** Rules that could be wrong stay quiet instead: variable checks stand down when code calls something whose use of variables cannot be seen, and nothing is reported on `${...}` parts that only exist when the bot runs. All 16 example bots of a ForgeScript knowledge base, which pass their tests, come back clean.
- **Positions you can click.** Every problem points at the file, line and column of the exact text, through JavaScript's escapes and template literals.
- **No dependencies.** It uses the ForgeScript the bot already has.

## Checking a bot

Run it in the bot's folder (Node.js 18.17 or newer; the bot's packages installed):

```bash
npx reforgiparse                       # the whole bot
npx reforgiparse commands/daily.js     # some files: custom functions are still read from the whole bot
npx reforgiparse --json                # for other tools
npx reforgiparse --rules               # what each rule checks
```

| Option | |
|---|---|
| `--format text\|json\|github` | Output: text (default), JSON, or GitHub Actions annotations. `--json` is `--format json`. |
| `--fix` | Fix what cannot change the bot, then check. See [Fixing](#fixing). |
| `--fix-brackets` | Also escape brackets that close a function too early. This changes what the bot sends, on purpose. |
| `--reindent` | Opt-in: indent lines that start with a function, `;` or `]` by nesting. See [Fixing](#fixing) for what it leaves alone. |
| `--config <file>` | Use this config. Default: `reforgiparse.config.json`, or `"reforgiparse"` in `package.json`. |
| `--no-warnings` | Errors only. |
| `--no-info` | Leave out the spelling hints. |
| `--quiet` | Print nothing when all is well. |
| `--property <name>` | Also read this property as code (besides `code`). |

The exit code is 1 when there are errors, and 2 for a wrong option or a config that cannot be used.

**What it reads**

- **Code:** the `code:` strings in `.js`, `.ts`, `.cjs`, `.mjs`, `.cts` and `.mts` files, read exactly as JavaScript reads them. It skips `node_modules`, folders starting with a dot, and `dist`, `build`, `docs`, `coverage` and `out` at the top.
- **Functions:** the installed ForgeScript and every installed dependency that uses it, extensions first as in a bot. An extension without `metadata/functions.json` has its `NativeFunction` files loaded, without starting it: nothing connects to Discord or a database.
- **Custom functions:** `{ name, params, code }` objects anywhere, and every `{ name, code }` in a `functions` folder. As in ForgeScript, a custom function without `params` takes no arguments.
- **Events:** ForgeScript's and the extensions', for each command's `type`.

## Rules

Each rule is backed by ForgeScript's source (2.8.0) or by running its own resolvers.

**Errors**: the code does not work.

| Rule | Example | What ForgeScript does |
|---|---|---|
| `missing-brackets` | `$get` | Refuses to compile the code. |
| `too-many-arguments` | `$get[a;b]` | Refuses to compile the code. |
| `unclosed-bracket` | `$get[a` | Refuses to compile the code. |
| `too-few-arguments` | `$addField[Coins]` | Stops the command: "Function $addField is missing argument value". |
| `invalid-argument` | `$round[abc]`, `$addButton[id;Hi;primary]`, `$wait[1.5h]` | Stops the command: "Given value abc for argument number is not of type Number". |
| `unknown-event` | `type: "messageCreat"` | Never runs the command. |

**Warnings**: the code runs, but not as written.

| Rule | Example | What ForgeScript does |
|---|---|---|
| `unknown-function` | `$sendMesage[...]` | Prints it as text. Suggests the closest name. |
| `glued-name` | `$pingms` | Runs `$ping`, prints `ms`. |
| `unexpected-brackets` | `$ping[x]` | Prints `[x]`. |
| `misplaced-operator` | `$#!ping`, `$!$ping` | Prints the call as text (the order is `$!#@[...]`). |
| `unescaped-bracket` | `$description[[Docs](url)]` | The first `]` closes the function; the rest is printed. |
| `condition-operator` | `$if[a==1&&b==2;...]`, `$if[yes;...]` | Only the first operator counts; `&&` is text; without an operator only `true` is true. |
| `color-value` | `$color[blue]`, `$color[123456]` | `blue` is `#00000b`; `123456` is decimal, not `#123456`. |
| `http-url` | an `http://` link where a URL is expected | Turns it into a broken emoji link. |
| `unused-variable` | `$let[a;1]` with no `$get[a]` | Nothing reads it. |
| `unset-variable` | `$get[a]` with no `$let[a;...]` | Always empty. |
| `wrong-store` | `$arrayCreate[list;3]$get[list]` | `$get` reads `$let` variables; arrays and JSON live where `$env` reads. |
| `deprecated` | `$createGuild[...]` | Marked deprecated by its package. |
| `unreadable-string` | a `code:` string that does not end where JavaScript would | Not checked. |
| `unknown-rule` | `$c[reforgiparse-disable-line glued-nme]` | A misspelt rule in a directive: it turns nothing off. |

**Info**: hints.

| Rule | Example | |
|---|---|---|
| `hidden-output` | `$let[ok;$pauseTrack]`, never read | `$!pauseTrack` hides the output without a variable. |
| `escaped-letter` | `$description[a\nb]` | Inside an argument `\n` is just `n`. |
| `function-case` | `$AUTHORID` | Works; the declared spelling is `$authorID`. |

## Fixing

```bash
npx reforgiparse --fix            # fixes what cannot change the bot, then checks
npx reforgiparse --fix-brackets   # also escapes brackets that close a function too early
npx reforgiparse --reindent       # opt-in: indents code by nesting
```

**`--fix` only makes edits that cannot change what the bot does.** Today that is the letter case of function names (`$AUTHORID` becomes `$authorID`). Each edit is checked by parsing the code before and after, with the same result as ForgeScript's compiler, and kept only if both give the same functions, arguments and errors. A name written with an escape in the file is left alone and reported.

**`--fix-brackets` changes what the bot sends, on purpose.** In `$description[[Docs](https://x.y)]` the first `]` closes `$description` and `(https://x.y)]` is printed after it. The fix escapes the `[` and that `]`, giving `$description[\[Docs\](https://x.y)]` (written `\\[` and `\\]` in a JavaScript string), so ForgeScript prints `[Docs](https://x.y)`. It is only made when it removes the problem and adds no compile error; otherwise it is reported and left alone.

**Re-indenting is opt-in: `--reindent`.** In ForgeScript, whitespace inside an argument or in the text around functions is part of what the bot sends, and ForgeScript only trims the two ends of a message. This prints four spaces before the name:

```
$if[1==1;
    $username
]
```

So `--fix` never touches indentation, and `--reindent` only does it when asked:

- It sets the indentation of lines that start with a function, a `;` or a `]`, by nesting depth (a `;` or `]` lines up with its function). Lines that start with text, and blank lines, stay as written.
- It leaves alone every line of an argument that also has text, since that whitespace is sent with the words. In a poll whose message lists options, partly as text and partly from `$if`, re-indenting the `$if` lines would shift those options in Discord.
- It never moves a line inside a condition: there the whitespace is part of what is compared, and `$if[` followed by `1==1` on an indented new line is false.
- It skips code that does not compile, and code in plain quoted strings. The result must parse the same apart from that whitespace, or nothing is written.
- Every line it changes or leaves alone is listed, so you can look at the messages near them.

What it cannot see: a line with no text around it whose function prints something, like `$username` alone in an `$if` branch. That indentation is still sent.

Spaces per level come from the config's `indent` (`2`, `4` or `"tab"`), or are detected from the code, else 4.

## Config

`reforgiparse.config.json` in the bot's folder, or a `"reforgiparse"` key in its `package.json`. It is JSON, so checking a bot never runs code from its config. Every option is optional; a list option also takes a single string.

```json
{
    "rules": { "function-case": "off", "glued-name": "error" },
    "exclude": ["tests"],
    "known": ["$priceOfTheDay"]
}
```

| Option | |
|---|---|
| `rules` | `"error"`, `"warning"`, `"info"` or `"off"` for any rule (`npx reforgiparse --rules` lists them). |
| `include` | Files and folders to check, from the bot's folder. Default: all of it. |
| `exclude` | File or folder names to skip anywhere (`"tests"`), or paths from the bot's folder (`"src/legacy"`). |
| `properties` | Properties whose strings are ForgeScript code. Default: `["code"]`. |
| `known` | Functions made when the bot runs, which no file defines: never reported as unknown. |
| `indent` | For `--reindent`: spaces per level (1 to 8), or `"tab"`. Default: detected from the code, else 4. |

A config that cannot be used is an error, never a silent default: an unknown option, a misspelt rule (with the closest name), or a wrong level stops the check with exit code 2.

## Turning rules off in code

In ForgeScript, with `$c[...]`, which prints nothing:

```
$c[reforgiparse-disable-next-line unknown-function]
$madeAtRuntime

$pingms $c[reforgiparse-disable-line glued-name]

$c[reforgiparse-disable]
... every rule off until ...
$c[reforgiparse-enable]
```

or as a JavaScript comment in the file, for the line after it or the line it is on:

```js
// reforgiparse-disable-next-line invalid-argument
module.exports = { name: "x", type: "messageCreate", code: "$round[abc]" }
```

Without rule names, a directive covers every rule; separate several with spaces or commas. A misspelt rule name is reported (`unknown-rule`), since it would turn nothing off. `forgelint-` directives are honoured too, so a bot moving from ForgeLint keeps the ones it has.

## In CI

```yaml
- run: npm ci
- run: npx reforgiparse --format github
```

Problems appear as annotations on the pull request's lines, and errors fail the job.

## Using the parser

```js
const { FunctionManager } = require("@tryforge/forgescript")
const { FunctionTable, parse, checkCode, Project } = require("reforgiparse")

FunctionManager.loadNative()
const table = FunctionTable.fromForgeScript()

parse("$if[$get[a]==1;yes;no]", table).functions[0].fields[0]   // { kind: "condition", op: "==", lhs, rhs, ... }
parse("$get[a", table)                                         // throws CompileError, line 1, column 6, as ForgeScript does
parse("$sendMessage $get[a", table, { recover: true }).errors  // every error, and a tree anyway

checkCode("$round[abc]", table)                                // the rules on one string
Project.load("./mybot").check()                                // the rules on a whole bot, with file, line and column
```

| | |
|---|---|
| `parse(code, table, { recover })` | `{ source, code, functions, errors }`. `code` is the top level as ForgeScript's template, with `[SYSTEM_FUNCTION(n)]` placeholders. Strict by default (throws the first error, like ForgeScript); `recover` reports all and keeps going. |
| `Call` | `name` (as registered), `written`, `index` (ForgeScript's number), `negated` (`$!`), `silent` (`$#`), `count` (`$@[...]`), `fields`, and the offsets `start`, `nameStart`, `nameEnd`, `open`, `close`, `separators`, `end`. |
| `Field` / `ConditionField` | `value` (with placeholders), `raw` (as written), `functions`, `start`, `end`; conditions have `op`, `lhs`, `rhs`, `opStart`. |
| `CompileError` | ForgeScript's `message`, `line`, `column`, plus `kind`, `start`, `end` (the text it is about) and `fn`. |
| `checkCode(code, table, { values })` | `{ rule, severity, message, start, end }[]`. Pass a `ValueChecker` to check argument values. |
| `Project.load(folder).check()` | `{ file, line, column, endLine, endColumn, severity, rule, message }[]`. |
| `extractCode(text)` | The `code:` strings of a JavaScript or TypeScript file, as ForgeScript receives them, with each character's offset in the file. |
| `fixText(text, table, { case, brackets, reindent, indent })` | `{ text, fixes, skipped }`: the file with the fixes made, what was fixed, and what was left alone and why. |
| `loadConfig(folder)`, `directivesIn(text)`, `isSuppressed(...)` | The config and the directives, for tools of your own. |
| `FunctionTable` | `fromForgeScript()`, `fromMetadata(...lists)`, or `new FunctionTable(raw)`. |
| `nameIssues`, `render`, `walk`, `usage`, `suggest` | Helpers. |

Offsets are UTF-16 indexes, like JavaScript string indexes.

## How it is tested

`npm test` (55 tests), in CI on Node 22 and 24, and on ForgeScript 2.8.0 and 2.5.0, the oldest the peer range allows.

**ForgeScript is the reference.** Every change that can affect parsing is diffed against ForgeScript's real compiler before it is committed, and any difference is a bug in ReForgiParse. `npm run parity` runs that diff; `REFORGIPARSE_CORPUS=<folder> npm run parity` adds every ForgeScript snippet under a folder. The rules for contributors are in [`CONTRIBUTING.md`](CONTRIBUTING.md).

What `npm test` checks:

- **Parity with ForgeScript's compiler**, the one installed, given the same functions: a hand-written set and 20,000 seeded random inputs, half of them well-formed nested calls and half every kind of broken code. Tree, template and errors must be identical. Each check was shown to fail when the parser is broken on purpose.
- **Positions**: every offset points at the character it names. **Recovery**: without errors the tree is strict mode's; with errors the first is ForgeScript's.
- **Reading files**: 15,000 random string and template literals read by ReForgiParse and evaluated by Node must be equal.
- **Every rule**, on code that has the problem and code that does not, with ForgeScript's resolvers deciding.
- **Every rule's claim, on ForgeScript's interpreter**: each rule's example is run offline on ForgeScript's real interpreter, and ForgeScript must do what the message says. Where a message quotes ForgeScript's error, ForgeScript must log exactly that text.
- **A whole bot**: an exact list of findings at their lines and columns; the command line's text, JSON and GitHub output and exit codes; an extension without metadata.
- **Config, directives and fixes**, on real bots in temporary folders: levels, `off`, `known`, `exclude`, the `package.json` key, and an error for each kind of config mistake; every directive, ForgeLint's included. `--fix` must leave what ForgeScript's own compiler makes of the code unchanged; after `--fix-brackets`, ForgeScript's interpreter must print the text as written; after `--reindent`, the compiler must see the same code apart from indentation, and the interpreter shows the indentation it moves is part of what `$if` returns, and that whitespace in a condition is compared.

Run by hand, not in CI: 6,931 snippets of a ForgeScript knowledge base and 168 from 16 example bots, with four extensions loaded, parse exactly as ForgeScript compiles them; `npx reforgiparse` on those 16 bots, with ForgeDB, ForgeGiveaways, ForgeMusic, ForgeLinked and the four ReForge extensions installed, reports no errors and no warnings; and `--reindent` on those 16 bots leaves every one of their 101 code strings compiling the same on ForgeScript apart from indentation, with the lines among message text (a poll's list of options) left as written.

## Compared with ForgeLint

[ForgeLint](https://github.com/Daaisukidayo/ForgeLint) 1.1.0 is the other checker for ForgeScript. Both have a config, comments that turn rules off (ReForgiParse reads ForgeLint's too), a letter-case fix, a bracket fix and re-indenting. ReForgiParse re-indents only when asked and leaves alone lines among message text and inside conditions (see [Fixing](#fixing)); its config is JSON rather than JavaScript. ForgeLint also has a stray-bracket rule. On the same 14 deliberate mistakes (the examples in [Rules](#rules)), ForgeLint reported 7 and ReForgiParse 15; ForgeLint missed both colour mistakes, the `http://` link, the `1.5h` duration, `&&` and a missing operator in conditions, the misordered `$#!`, and `$get` of an array. On a small bot, ForgeLint reported a custom function without `params` as unknown; ReForgiParse knows it, and that its brackets get printed.

ReForgiParse is written from scratch and shares no code with ForgeLint.

## Licence

LGPL-3.0-or-later (`COPYING.LESSER`, with the GPL it extends in `COPYING`), like ForgeScript, whose compiler it reproduces. Not affiliated with BotForge.
