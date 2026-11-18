# Contributing to ReForgiParse

ReForgiParse promises that it reads code exactly as ForgeScript does, and that every rule says what
ForgeScript really does with the code. These rules keep that promise.

## ForgeScript is the reference

1. **Diff every parsing change against ForgeScript's compiler.** Anything in `src/parser.ts`,
   `src/table.ts`, `src/names.ts`, or in how a project's functions are loaded, is compared with
   `new Compiler(undefined, code).compile()` of the installed `@tryforge/forgescript`, given the same
   function list, before it is committed:
   - `npm run parity`: a hand-written corpus and 20,000 seeded random inputs.
   - `REFORGIPARSE_CORPUS=<folder of bots or docs> npm run parity`: every ForgeScript snippet under it.
   - The oldest supported ForgeScript: `npm i --no-save @tryforge/forgescript@2.5.0 && npm test`, then `npm ci`.

   Tree, template and compile errors (message, line, column) must be identical. A difference means
   ReForgiParse is wrong, never ForgeScript: match it, quirks included.
2. **Put new kinds of input into the diff.** A bug or a new syntax case goes into
   `test/support/corpus.js`, and a whole class of input into `test/support/fuzz.js`. Show the test
   fails without the fix.
3. **Show the diff can fail.** After changing the parser or the tests, break the parser on purpose
   (column counting, escapes, an error kind) and check the tests go red. Then restore it.

## Rules state facts, checked in ForgeScript

4. **A rule's message says what ForgeScript does**, and that is checked in ForgeScript itself: in its
   source (the installed `dist/`; name the file in the pull request) and, wherever it can run
   offline, by running it. `test/runtime.test.js` runs each rule's example on ForgeScript's real
   interpreter and checks the outcome; a message that quotes ForgeScript's error must quote exactly
   what ForgeScript logs. Prefer calling ForgeScript's own code (its resolvers, `Conditions`,
   `Compiler`) over copying its logic, so a check follows the bot's version. Never write
   "ForgeScript does X" from memory.
5. **Working bots stay clean.** Before a release, run `npx reforgiparse` on working bots with their
   extensions installed. Every finding there is a bug in ReForgiParse until shown otherwise.

## Conventions

- Fresh code only, LGPL-3.0-or-later. Do not copy ForgeLint (GPL-3.0-only); ideas may be
  re-implemented.
- `dist/` is committed and must match `src/` (CI checks): run `npm run build` before committing.
- `engines` stays `>=18.17`. No runtime dependencies.
- Every fix and every rule gets a test that fails without it.
