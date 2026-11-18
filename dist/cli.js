#!/usr/bin/env node
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.main = main;
// SPDX-License-Identifier: LGPL-3.0-or-later
const path = __importStar(require("node:path"));
const project_1 = require("./project");
const rules_1 = require("./rules");
const HELP = `reforgiparse: checks a ForgeScript bot's code the way ForgeScript compiles and runs it.

Usage: reforgiparse [folder | files...] [options]

  --format <name>     text (default), json, or github (annotations in GitHub Actions)
  --json              same as --format json
  --property <name>   also read this property as code (repeatable; default: code)
  --no-warnings       report errors only
  --no-info           leave out info (spelling hints)
  --quiet             print nothing when there is no problem
  --rules             list the rules
  -h, --help          show this help
  -v, --version       show the version

Exit code: 0 without errors, 1 with errors, 2 for bad usage.`;
function parseArgs(argv) {
    const paths = [];
    const out = { root: ".", include: [], format: "text", properties: [], warnings: true, info: true, quiet: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "-h" || a === "--help")
            return console.log(HELP), 0;
        if (a === "-v" || a === "--version")
            return console.log(require("../package.json").version), 0;
        if (a === "--rules") {
            for (const [name, r] of Object.entries(rules_1.Rules))
                console.log(`${name.padEnd(20)} ${r.severity.padEnd(8)} ${r.description}`);
            console.log(`${"unknown-event".padEnd(20)} ${"error".padEnd(8)} A command's type that no loaded package has as an event: the command never runs.`);
            console.log(`${"unreadable-string".padEnd(20)} ${"warning".padEnd(8)} A code string JavaScript would not end where it seems to: not checked.`);
            return 0;
        }
        if (a === "--json")
            out.format = "json";
        else if (a === "--format") {
            const v = argv[++i];
            if (v !== "text" && v !== "json" && v !== "github")
                return console.error("--format takes text, json or github"), 2;
            out.format = v;
        }
        else if (a === "--no-warnings")
            (out.warnings = false), (out.info = false);
        else if (a === "--no-info")
            out.info = false;
        else if (a === "--quiet")
            out.quiet = true;
        else if (a === "--property") {
            const v = argv[++i];
            if (!v)
                return console.error("--property needs a name"), 2;
            out.properties.push(v);
        }
        else if (a.startsWith("-"))
            return console.error(`Unknown option ${a}. See reforgiparse --help.`), 2;
        else
            paths.push(a);
    }
    // One folder: the project. Files (or several paths): the project is the current folder.
    if (paths.length === 1 && !/\.(c|m)?(j|t)s$/.test(paths[0]))
        out.root = paths[0];
    else
        out.include = paths;
    if (out.properties.length)
        out.properties.unshift("code");
    return out;
}
const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
const SEVERITY_COLOR = { error: "31", warning: "33", info: "36" };
function text(d) {
    return `${paint("2", `${d.file}:${d.line}:${d.column}`)}  ${paint(SEVERITY_COLOR[d.severity], d.severity.padEnd(7))}  ${d.message}  ${paint("2", `[${d.rule}]`)}`;
}
/** A GitHub Actions workflow command: shown on the pull request's changed lines. */
function github(d) {
    const level = d.severity === "error" ? "error" : d.severity === "warning" ? "warning" : "notice";
    const esc = (s) => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
    const prop = (s) => esc(s).replace(/:/g, "%3A").replace(/,/g, "%2C");
    return `::${level} file=${prop(d.file)},line=${d.line},col=${d.column},endLine=${d.endLine},endColumn=${d.endColumn},title=${prop(`reforgiparse ${d.rule}`)}::${esc(d.message)}`;
}
function main(argv = process.argv.slice(2)) {
    const args = parseArgs(argv);
    if (typeof args === "number")
        return args;
    const project = project_1.Project.load(args.root, { include: args.include, properties: args.properties });
    const diagnostics = project.check().filter((d) => d.severity === "error" || (d.severity === "warning" ? args.warnings : args.info));
    const count = (s) => diagnostics.filter((d) => d.severity === s).length;
    const errors = count("error");
    if (args.format === "json") {
        console.log(JSON.stringify({ root: project.root, files: project.files.length, functions: project.table.size, sources: project.sources, notes: project.notes, errors, warnings: count("warning"), info: count("info"), diagnostics }, null, 2));
        return errors ? 1 : 0;
    }
    for (const note of project.notes)
        console.error(`note: ${note}`);
    if (args.format === "github") {
        for (const d of diagnostics)
            console.log(github(d));
        return errors ? 1 : 0;
    }
    let file = "";
    for (const d of diagnostics) {
        if (d.file !== file && file)
            console.log("");
        file = d.file;
        console.log(text(d));
    }
    if (diagnostics.length || !args.quiet) {
        const from = project.sources.map((s) => `${s.name}${s.version ? ` ${s.version}` : ""}`).join(", ") || "none";
        const parts = [`${errors} error(s)`, `${count("warning")} warning(s)`, ...(count("info") ? [`${count("info")} info`] : [])];
        const where = `${project.files.length} file(s) under ${path.relative(process.cwd(), project.root) || "."}`;
        console.log(`${diagnostics.length ? "\n" : ""}${paint(errors ? "31" : diagnostics.length ? "33" : "32", parts.join(", "))} in ${where} ${paint("2", `(functions: ${from})`)}`);
    }
    return errors ? 1 : 0;
}
if (require.main === module)
    process.exitCode = main();
//# sourceMappingURL=cli.js.map