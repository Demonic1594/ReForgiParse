# ForgeParse: rules for working on this repository

## ForgeScript is the reference. Always diff against it.

ForgeParse's whole promise is that it reads code exactly as ForgeScript does. So:

1. **Every change that can affect parsing is diffed against ForgeScript's real compiler**
   (`new Compiler(undefined, code).compile()` from the installed `@tryforge/forgescript`, given the
   same function list) before it is committed. That means anything in `src/parser.ts`, `src/table.ts`,
   `src/names.ts`, or the function list a project is loaded with.
   - Run `npm run parity` (the parity tests: hand-written corpus plus 20,000 seeded random inputs).
   - Also run it on real code: `FORGEPARSE_CORPUS=<folder of bots or docs> npm run parity`.
   - Run it on the oldest supported ForgeScript too: `npm i --no-save @tryforge/forgescript@2.5.0 && npm run parity`, then `npm ci`.
   - Zero differences in tree, template and compile errors (message, line, column). A difference
     means ForgeParse is wrong, never ForgeScript: fix ForgeParse to match, quirks included.
2. **A new kind of input gets into the diff.** When a bug or a new syntax case is found, add it to
   `test/support/corpus.js` and, if it is a class of input, to the generator in `test/support/fuzz.js`,
   and show that the parity test fails without the fix.
3. **Prove the diff can fail.** After changing the parser or the tests, break the parser on purpose
   (column counting, escapes, an error kind) and check the parity tests go red, then restore it.
4. **Rules state facts about ForgeScript, checked in ForgeScript.** Every rule's message says what
   ForgeScript does. Before adding or changing one, check it in ForgeScript's source (the installed
   `dist/`, name the file) or by running its own code (its resolvers, `Conditions`, `Compiler`).
   Prefer calling ForgeScript's code over copying its logic, so the check follows the bot's version.
   Never write "ForgeScript does X" from memory.
5. **Real bots stay clean.** Bots that work must not get false findings. Before a release, run
   `npx forgeparse` on working bots with their extensions installed; every finding there is a bug in
   ForgeParse until shown otherwise.

## Conventions

- Fresh code only, LGPL-3.0-or-later. Do not copy ForgeLint (GPL-3.0-only). Ideas may be reused, re-implemented.
- `dist/` is committed and must match `src/` (CI checks it): run `npm run build` before committing.
- `engines` stays `>=18.17`. No runtime dependencies.
- Every fix and every rule gets a test that fails without it.
