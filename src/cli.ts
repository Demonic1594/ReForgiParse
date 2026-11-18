#!/usr/bin/env node
// SPDX-License-Identifier: LGPL-3.0-or-later
import * as path from "node:path"
import { Diagnostic, Project } from "./project"

const HELP = `forgeparse: checks a ForgeScript bot's code as ForgeScript compiles it.

Usage: forgeparse [folder or files...] [options]

  --json              print the result as JSON
  --property <name>   also read this property as code (repeatable; default: code)
  --no-warnings       report errors only
  --quiet             print nothing when there is no problem
  -h, --help          show this help
  -v, --version       show the version

Exit code: 0 without errors, 1 with errors, 2 for bad usage.`

interface Args {
    root: string
    include: string[]
    json: boolean
    properties: string[]
    warnings: boolean
    quiet: boolean
}

function parseArgs(argv: string[]): Args | number {
    const paths: string[] = []
    const out: Args = { root: ".", include: [], json: false, properties: [], warnings: true, quiet: false }
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i]
        if (a === "-h" || a === "--help") return console.log(HELP), 0
        if (a === "-v" || a === "--version") return console.log(require("../package.json").version), 0
        if (a === "--json") out.json = true
        else if (a === "--no-warnings") out.warnings = false
        else if (a === "--quiet") out.quiet = true
        else if (a === "--property") {
            const v = argv[++i]
            if (!v) return console.error("--property needs a name"), 2
            out.properties.push(v)
        } else if (a.startsWith("-")) return console.error(`Unknown option ${a}. See forgeparse --help.`), 2
        else paths.push(a)
    }
    // One folder: the project. Files (or several paths): the project is the current folder.
    if (paths.length === 1 && !/\.(c|m)?(j|t)s$/.test(paths[0])) out.root = paths[0]
    else out.include = paths
    if (out.properties.length) out.properties.unshift("code")
    return out
}

function format(d: Diagnostic) {
    return `${d.file}:${d.line}:${d.column}  ${d.severity.padEnd(7)}  ${d.message}  [${d.rule}]`
}

export function main(argv = process.argv.slice(2)): number {
    const args = parseArgs(argv)
    if (typeof args === "number") return args
    const project = Project.load(args.root, { include: args.include, properties: args.properties })
    let diagnostics = project.check()
    if (!args.warnings) diagnostics = diagnostics.filter((d) => d.severity === "error")
    const errors = diagnostics.filter((d) => d.severity === "error").length
    const warnings = diagnostics.length - errors
    if (args.json) {
        console.log(JSON.stringify({ root: project.root, files: project.files.length, functions: project.table.size, sources: project.sources, notes: project.notes, errors, warnings, diagnostics }, null, 2))
        return errors ? 1 : 0
    }
    for (const note of project.notes) console.error(`note: ${note}`)
    for (const d of diagnostics) console.log(format(d))
    if (diagnostics.length || !args.quiet) {
        const from = project.sources.map((s) => `${s.name}${s.version ? ` ${s.version}` : ""}`).join(", ") || "none"
        console.log(`\n${errors} error(s), ${warnings} warning(s) in ${project.files.length} file(s) under ${path.relative(process.cwd(), project.root) || "."} (functions: ${from})`)
    }
    return errors ? 1 : 0
}

if (require.main === module) process.exitCode = main()
