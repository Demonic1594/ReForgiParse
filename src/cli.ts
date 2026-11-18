#!/usr/bin/env node
// SPDX-License-Identifier: LGPL-3.0-or-later
import * as fs from "node:fs"
import * as path from "node:path"
import { ConfigError, loadConfig } from "./config"
import { closest } from "./core"
import { fixText } from "./fix"
import { Diagnostic, Project, ProjectRules } from "./project"
import { Rules } from "./rules"

const HELP = `reforgiparse: checks a ForgeScript bot's code the way ForgeScript compiles and runs it.

Usage: reforgiparse [folders or files...] [options]

With no paths, checks the bot in the current folder. A folder or file inside a bot is checked as
part of that bot (the nearest folder above it with a package.json), with all of its functions.

  --format <name>       text (default), json, or github (annotations in GitHub Actions)
  --json                same as --format json
  --fix                 fix what cannot change the bot (names' letter case), then check
  --fix-brackets        also escape [ ] in text that close a function too early (changes what the bot sends)
  --reindent            indent lines that start with a function, ; or ] by nesting (can change what the bot sends)
  --config <file>       the config to use (default: reforgiparse.config.json, or "reforgiparse" in package.json)
  --property <name>     also read this property as code (repeatable; default: code)
  --max-warnings <n>    exit with code 1 when there are more than n warnings
  --no-warnings         report errors only
  --no-info             leave out info (spelling hints)
  --quiet               print nothing when there is no problem
  --rules               list the rules
  --lsp                 run as a language server on stdin and stdout, for editors
  -h, --help            show this help
  -v, --version         show the version

Exit code: 0 without errors, 1 with errors (or more warnings than --max-warnings),
2 for bad usage or an invalid config.`

type Format = "text" | "json" | "github"

interface Args {
    root: string
    include: string[]
    format: Format
    properties: string[]
    warnings: boolean
    info: boolean
    quiet: boolean
    fix: boolean
    fixBrackets: boolean
    reindent: boolean
    config: string | undefined
    maxWarnings: number | undefined
}

const FLAGS = ["--json", "--fix", "--fix-brackets", "--reindent", "--no-warnings", "--no-info", "--quiet", "--rules", "--lsp", "--help", "--version"]
const WITH_VALUE = ["--format", "--config", "--property", "--max-warnings"]
/** Extensions of the files that are read. */
const CODE_FILE = /\.(c|m)?(j|t)s$/

/** Usage problems: printed with the help hint, exit code 2. */
class UsageError extends Error {}

function parseArgs(argv: string[]): Args | number {
    const paths: string[] = []
    const out: Args = { root: ".", include: [], format: "text", properties: [], warnings: true, info: true, quiet: false, fix: false, fixBrackets: false, reindent: false, config: undefined, maxWarnings: undefined }
    for (let i = 0; i < argv.length; i++) {
        let a = argv[i]
        // --name=value is the same as --name value.
        let inline: string | undefined
        const eq = a.startsWith("--") ? a.indexOf("=") : -1
        if (eq > 0 && WITH_VALUE.includes(a.slice(0, eq))) (inline = a.slice(eq + 1)), (a = a.slice(0, eq))
        const value = () => (inline !== undefined ? inline : argv[++i])

        if (a === "-h" || a === "--help") return console.log(HELP), 0
        if (a === "-v" || a === "--version") return console.log(require("../package.json").version), 0
        if (a === "--lsp") return require("./lsp").serve(), -1
        if (a === "--rules") {
            for (const [name, r] of [...Object.entries(Rules), ...Object.entries(ProjectRules)]) console.log(`${name.padEnd(20)} ${r.severity.padEnd(8)} ${r.description}`)
            return 0
        }
        if (a === "--json") out.format = "json"
        else if (a === "--format") {
            const v = value()
            if (v !== "text" && v !== "json" && v !== "github") throw new UsageError(`--format takes text, json or github${v ? `, not "${v}"` : ""}`)
            out.format = v
        } else if (a === "--no-warnings") (out.warnings = false), (out.info = false)
        else if (a === "--no-info") out.info = false
        else if (a === "--quiet") out.quiet = true
        else if (a === "--fix") out.fix = true
        else if (a === "--fix-brackets") (out.fix = true), (out.fixBrackets = true)
        else if (a === "--reindent") out.reindent = true
        else if (a === "--config") {
            const v = value()
            if (!v) throw new UsageError("--config needs a file")
            out.config = v
        } else if (a === "--property") {
            const v = value()
            if (!v) throw new UsageError("--property needs a name")
            out.properties.push(v)
        } else if (a === "--max-warnings") {
            const v = value()
            if (!v || !/^\d+$/.test(v)) throw new UsageError(`--max-warnings needs a number of warnings${v ? `, not "${v}"` : ""}`)
            out.maxWarnings = Number(v)
        } else if (a.startsWith("-")) {
            const guess = closest(a, [...FLAGS, ...WITH_VALUE])
            throw new UsageError(`unknown option ${a}${guess ? ` (did you mean ${guess}?)` : ""}`)
        } else paths.push(a)
    }
    Object.assign(out, project(paths))
    if (out.properties.length) out.properties.unshift("code")
    return out
}

/**
 * The bot the paths belong to and what to check in it. The bot is the nearest folder with a
 * package.json, from the first path up, so a folder or file inside a bot is checked with the
 * bot's custom functions, extensions and config.
 */
function project(paths: string[]): { root: string; include: string[] } {
    if (!paths.length) return { root: ".", include: [] }
    const resolved = paths.map((p) => {
        const abs = path.resolve(p)
        if (!fs.existsSync(abs)) throw new UsageError(`${p}: no such file or folder`)
        const file = fs.statSync(abs).isFile()
        if (file && !CODE_FILE.test(abs)) throw new UsageError(`${p}: not a JavaScript or TypeScript file (.js, .ts, .cjs, .mjs, .cts or .mts)`)
        return { given: p, abs, file }
    })
    const first = resolved[0]
    const from = first.file ? path.dirname(first.abs) : first.abs
    let root: string | null = null
    for (let d = from; ; d = path.dirname(d)) {
        if (fs.existsSync(path.join(d, "package.json"))) {
            root = d
            break
        }
        if (path.dirname(d) === d) break
    }
    // No package.json above: the folder given, or the current folder for files.
    root ??= first.file ? process.cwd() : first.abs
    const include: string[] = []
    for (const r of resolved) {
        const rel = path.relative(root, r.abs)
        if (rel.startsWith("..") || path.isAbsolute(rel)) throw new UsageError(`${r.given} is not in the bot at ${path.relative(process.cwd(), root) || "."}: check one bot at a time`)
        if (rel) include.push(rel)
    }
    // The bot's own folder among the paths: all of it.
    return { root, include: include.length < resolved.length ? [] : include }
}

const env = process.env
const color = env.FORCE_COLOR !== undefined ? env.FORCE_COLOR !== "0" && env.FORCE_COLOR !== "false" : !env.NO_COLOR && !!process.stdout.isTTY
const paint = (code: string, s: string) => (color ? `\x1b[${code}m${s}\x1b[0m` : s)
const SEVERITY_COLOR = { error: "31", warning: "33", info: "36" } as const

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** One file's findings, the locations padded so the severities line up. */
function textBlock(found: Diagnostic[]): string[] {
    const where = (d: Diagnostic) => `${d.file}:${d.line}:${d.column}`
    const width = Math.max(...found.map((d) => where(d).length))
    return found.map((d) => `${paint("2", where(d).padEnd(width))}  ${paint(SEVERITY_COLOR[d.severity], d.severity.padEnd(7))}  ${d.message}  ${paint("2", `[${d.rule}]`)}`)
}

/** A GitHub Actions workflow command: shown on the pull request's changed lines. */
function github(d: Diagnostic) {
    const level = d.severity === "error" ? "error" : d.severity === "warning" ? "warning" : "notice"
    const esc = (s: string) => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A")
    const prop = (s: string) => esc(s).replace(/:/g, "%3A").replace(/,/g, "%2C")
    return `::${level} file=${prop(d.file)},line=${d.line},col=${d.column},endLine=${d.endLine},endColumn=${d.endColumn},title=${prop(`reforgiparse ${d.rule}`)}::${esc(d.message)}`
}

export function main(argv = process.argv.slice(2)): number {
    let args: Args
    let project: Project
    try {
        const parsed = parseArgs(argv)
        if (typeof parsed === "number") return parsed
        args = parsed
        const config = loadConfig(path.resolve(args.root), args.config).config
        project = Project.load(args.root, { include: args.include, properties: args.properties, config })
    } catch (e) {
        if (e instanceof UsageError) {
            console.error(`reforgiparse: ${e.message}. See reforgiparse --help.`)
            return 2
        }
        if (e instanceof ConfigError) {
            const file = path.isAbsolute(e.file) ? path.relative(process.cwd(), e.file) || e.file : e.file
            console.error(`reforgiparse: config: ${file}: ${e.detail}`)
            return 2
        }
        throw e
    }
    if (args.fix || args.reindent) {
        let fixed = 0
        for (const file of project.files) {
            const before = fs.readFileSync(file, "utf8")
            const r = fixText(before, project.table, { properties: project.properties, case: args.fix, brackets: args.fixBrackets, reindent: args.reindent, indent: project.config.indent })
            const rel = path.relative(project.root, file).split(path.sep).join("/")
            const where = (offset: number) => {
                const head = before.slice(0, offset)
                return `${rel}:${head.split("\n").length}:${offset - head.lastIndexOf("\n")}`
            }
            for (const f of r.fixes) console.error(`fixed  ${where(f.offset)}  ${f.description}`)
            for (const f of r.skipped) console.error(`left   ${where(f.offset)}  ${f.description}`)
            if (r.text !== before) {
                fs.writeFileSync(file, r.text)
                fixed += r.fixes.length
            }
        }
        if (fixed) console.error(`${plural(fixed, "fix", "fixes")} written.\n`)
    }
    const diagnostics = project.check().filter((d) => d.severity === "error" || (d.severity === "warning" ? args.warnings : args.info))
    const count = (s: Diagnostic["severity"]) => diagnostics.filter((d) => d.severity === s).length
    const errors = count("error")
    const warnings = count("warning")
    const tooManyWarnings = args.maxWarnings !== undefined && warnings > args.maxWarnings
    const exit = errors || tooManyWarnings ? 1 : 0

    if (args.format === "json") {
        console.log(JSON.stringify({ root: project.root, files: project.files.length, functions: project.table.functions.length, sources: project.sources, notes: project.notes, errors, warnings, info: count("info"), diagnostics }, null, 2))
        return exit
    }
    for (const note of project.notes) console.error(`note: ${note}`)
    if (args.format === "github") {
        for (const d of diagnostics) console.log(github(d))
        if (tooManyWarnings) console.log(`::error title=reforgiparse::${plural(warnings, "warning")}, more than --max-warnings ${args.maxWarnings}`)
        return exit
    }
    const byFile = new Map<string, Diagnostic[]>()
    for (const d of diagnostics) byFile.set(d.file, [...(byFile.get(d.file) ?? []), d])
    for (const [i, found] of [...byFile.values()].entries()) {
        if (i) console.log("")
        for (const line of textBlock(found)) console.log(line)
    }
    if (diagnostics.length || !args.quiet) {
        const under = path.relative(process.cwd(), project.root)
        const files = `${plural(project.files.length, "file")}${under ? ` under ${under}` : ""}`
        const parts = [plural(errors, "error"), plural(warnings, "warning"), ...(count("info") ? [`${count("info")} info`] : [])]
        const summary = diagnostics.length ? `${parts.join(", ")} in ${files}` : `No problems in ${files}`
        const from = project.sources.map((s) => `${s.name}${s.version ? ` ${s.version}` : ""}`).join(", ") || "none"
        console.log(`${diagnostics.length ? "\n" : ""}${paint(errors || tooManyWarnings ? "31" : diagnostics.length ? "33" : "32", summary)}`)
        if (tooManyWarnings) console.log(paint("31", `More than --max-warnings ${args.maxWarnings}: exit code 1.`))
        console.log(paint("2", `Functions from ${from}.`))
    }
    return exit
}

if (require.main === module) {
    const code = main()
    // -1: the language server keeps running until the editor ends it.
    if (code >= 0) process.exitCode = code
}
