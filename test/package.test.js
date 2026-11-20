"use strict"
// The package as a bot installs it: the files npm publishes, the command, and the type declarations
// for both entry points under each of TypeScript's module resolutions (a bot compiled with
// "module": "commonjs" uses node10, which ignores package.json "exports").
const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { execFileSync, spawnSync } = require("node:child_process")

const ROOT = path.join(__dirname, "..")
const MODULES = path.join(ROOT, "node_modules")

test("npm publishes the compiled code, its declarations, the docs and the licences, and nothing else", () => {
    const npm = process.platform === "win32" ? "npm.cmd" : "npm"
    // npm 10 and 11 print a list of packages, npm 12 an object keyed by name.
    const out = JSON.parse(execFileSync(npm, ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: ROOT, encoding: "utf8", shell: process.platform === "win32" }))
    const pack = Array.isArray(out) ? out[0] : Object.values(out)[0]
    assert.ok(pack?.files, JSON.stringify(out).slice(0, 500))
    const files = pack.files.map((f) => f.path).sort()
    for (const f of ["README.md", "CHANGELOG.md", "COPYING", "COPYING.LESSER", "package.json", "dist/cli.js", "dist/index.js", "dist/index.d.ts", "dist/core.js", "dist/core.d.ts", "dist/lsp.js"]) assert.ok(files.includes(f), `${f} is published`)
    assert.deepEqual(files.filter((f) => !/^(dist\/[\w.]+\.(js|d\.ts)|README\.md|CHANGELOG\.md|COPYING(\.LESSER)?|package\.json)$/.test(f)), [], "no source maps, sources or tests")
    assert.match(fs.readFileSync(path.join(ROOT, "dist", "cli.js"), "utf8"), /^#!\/usr\/bin\/env node\n/)
})

test("TypeScript finds the types of reforgiparse and reforgiparse/core under node10, node16 and bundler resolution", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reforgiparse-types-"))
    fs.mkdirSync(path.join(dir, "node_modules"))
    fs.symlinkSync(ROOT, path.join(dir, "node_modules", "reforgiparse"), "dir")
    fs.symlinkSync(path.join(MODULES, "@types"), path.join(dir, "node_modules", "@types"), "dir")
    fs.writeFileSync(
        path.join(dir, "bot.ts"),
        [
            'import { checkScript, FunctionTable, type Diagnostic } from "reforgiparse/core"',
            'import { Project } from "reforgiparse"',
            "const table: FunctionTable = FunctionTable.fromMetadata([{ name: \"$ping\", brackets: null }])",
            "const found: Diagnostic[] = checkScript('module.exports = { code: \"$pingms\" }', table)",
            "export const rules: string[] = found.map((d) => d.rule)",
            "export const load: typeof Project.load = Project.load",
            "",
        ].join("\n"),
    )
    const tsc = path.join(MODULES, "typescript", "bin", "tsc")
    for (const [resolution, mod] of [["node10", "commonjs"], ["node16", "node16"], ["bundler", "preserve"]]) {
        const r = spawnSync(process.execPath, [tsc, "--noEmit", "--strict", "--module", mod, "--moduleResolution", resolution, "--types", "node", "bot.ts"], { cwd: dir, encoding: "utf8" })
        assert.equal(r.status, 0, `${resolution}: ${r.stdout}${r.stderr}`)
    }
})
