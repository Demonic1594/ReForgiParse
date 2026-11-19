# Contributing to ReForgiParse

ReForgiParse makes two guarantees:

1. It parses code exactly as ForgeScript's compiler does.
2. Every finding describes what ForgeScript actually does with the code.

The requirements below exist to keep both.

## Development

```bash
npm ci
npm test         # builds, then runs the full suite
npm run parity   # builds, then runs the parser comparison only
```

Requires Node.js 18.17 or later.

## Parser changes

These requirements apply to `src/parser.ts`, `src/table.ts`, `src/names.ts` and the code that loads a project's functions.

### Compare with ForgeScript's compiler

Every change is compared with `new Compiler(undefined, code).compile()` from the installed `@tryforge/forgescript`, using the same function list:

| Command | Coverage |
|---|---|
| `npm run parity` | Hand-written corpus and 20,000 seeded generated inputs. |
| `REFORGIPARSE_CORPUS=<folder> npm run parity` | Every ForgeScript snippet in a folder of bots or documentation. |
| `npm i --no-save @tryforge/forgescript@2.5.0 && npm test`, then `npm ci` | The oldest supported ForgeScript version. |
| The same for each version `npm view @tryforge/forgescript versions` lists in the peer range | Before a release: CI tests only the oldest and the newest. |

The tree, the template and the compile errors (message, line and column) must be identical. ForgeScript defines the language, so any difference is a defect in ReForgiParse, including differences in ForgeScript's quirks.

### Add regression inputs

Add a specific case to `test/support/corpus.js`, or a class of inputs to the generator in `test/support/fuzz.js`. The test must fail without the change. This keeps the case covered by every later comparison.

### Confirm the tests can fail

After changing the parser or its tests, introduce a deliberate fault (for example in column counting, escape handling or an error kind), confirm the suite fails, then revert it. A comparison that cannot fail does not verify anything.

## Rules

### Verify every claim in ForgeScript

A rule's message states what ForgeScript does, and that statement must be verified in ForgeScript itself:

- **In its source.** Use the installed `dist/` and cite the file in the pull request.
- **At runtime, where possible.** `test/runtime.test.js` runs each rule's example on ForgeScript's interpreter wherever this works without Discord.

A message that quotes a ForgeScript error must match the logged text exactly. Do not describe ForgeScript's behaviour from memory.

### Prefer ForgeScript's own code

Call ForgeScript's resolvers, `Conditions` and `Compiler` instead of reimplementing their logic. Checks then follow the ForgeScript version installed in the bot.

### Check what a function does without each argument

A function that reads its own arguments (`unwrap: false`, such as `$if` or `$while`) is not covered by ForgeScript's check for a missing argument. What leaving one out does is different for each function, so it is established on ForgeScript's interpreter and recorded in `UncheckedArguments` (`src/rules.ts`) with an example call that `test/runtime.test.js` runs. A function whose outcome cannot be shown without Discord is left out rather than guessed.

### Keep working bots clean

Before a release, run `npx reforgiparse` on working bots with their extensions installed. Treat any finding there as a defect in ReForgiParse until shown otherwise.

## Conventions

| Area | Requirement |
|---|---|
| License | Contributions are LGPL-3.0-or-later. Do not copy code from ForgeLint, which is GPL-3.0-only; its ideas may be reimplemented independently. |
| Build output | `dist/` is committed and must match `src/`. Run `npm run build` before committing; CI checks this. |
| Package | `files` in `package.json` lists what is published. `test/package.test.js` checks the published files and the type declarations, and CI installs the packed package into an empty bot and runs it. |
| Compatibility | `engines` stays at `>=18.17`. No runtime dependencies. |
| Tests | Every fix and every rule has a test that fails without it. |

## Pull request checklist

- [ ] `npm test` passes.
- [ ] Parser changes: `npm run parity` passes on the current and the oldest supported ForgeScript.
- [ ] Rule changes: the ForgeScript source file behind each claim is cited.
- [ ] `dist/` is rebuilt.
- [ ] `CHANGELOG.md` is updated.
