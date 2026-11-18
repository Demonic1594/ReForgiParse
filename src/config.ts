// SPDX-License-Identifier: LGPL-3.0-or-later
//
// The config: `reforgiparse.config.json` in the bot's folder, or a "reforgiparse" key in its
// package.json. JSON, not JavaScript, so checking a bot never runs code from its config.

import * as fs from "node:fs"
import * as path from "node:path"

export type Level = "error" | "warning" | "info" | "off"

export interface Config {
    /** A level for any rule: `error`, `warning`, `info`, or `off`. */
    rules?: Record<string, Level>
    /** Files and folders to check, relative to the bot's folder (default: all of it). */
    include?: string[]
    /** File or folder names to skip anywhere (`"tests"`), or paths from the bot's folder (`"src/legacy"`). */
    exclude?: string[]
    /** Properties whose strings are ForgeScript code (default `["code"]`). */
    properties?: string[]
    /** Functions made when the bot runs, which no file defines: never reported as unknown. */
    known?: string[]
}

export const CONFIG_FILE = "reforgiparse.config.json"
const LEVELS = new Set(["error", "warning", "info", "off"])

export class ConfigError extends Error {
    constructor(file: string, message: string) {
        super(`${file}: ${message}`)
        this.name = "ConfigError"
    }
}

/**
 * The config for a bot's folder: `file` when given, else `reforgiparse.config.json` there, else the
 * "reforgiparse" key of its package.json, else none. Throws a ConfigError for a config that cannot
 * be used, so a typo never silently checks with other settings.
 */
export function loadConfig(root: string, file?: string): { config: Config; file: string | null } {
    let where: string | null = null
    let raw: unknown
    if (file) {
        where = path.resolve(root, file)
        raw = readJson(where)
    } else if (fs.existsSync(path.join(root, CONFIG_FILE))) {
        where = path.join(root, CONFIG_FILE)
        raw = readJson(where)
    } else {
        const pj = path.join(root, "package.json")
        const data = fs.existsSync(pj) ? (readJson(pj) as Record<string, unknown>) : null
        if (data && data.reforgiparse !== undefined) {
            where = `${pj} ("reforgiparse")`
            raw = data.reforgiparse
        }
    }
    if (!where) return { config: {}, file: null }
    return { config: validate(raw, where), file: where }
}

function readJson(file: string): unknown {
    let text: string
    try {
        text = fs.readFileSync(file, "utf8")
    } catch {
        throw new ConfigError(file, "cannot be read")
    }
    try {
        return JSON.parse(text)
    } catch (e) {
        throw new ConfigError(file, `is not valid JSON (${(e as Error).message})`)
    }
}

function validate(raw: unknown, where: string): Config {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ConfigError(where, "must be an object")
    const out: Config = {}
    const strings = (key: keyof Config) => {
        const v = (raw as Record<string, unknown>)[key]
        if (v === undefined) return undefined
        const list = typeof v === "string" ? [v] : v
        if (!Array.isArray(list) || !list.every((x) => typeof x === "string")) throw new ConfigError(where, `"${key}" must be a string or a list of strings`)
        return list as string[]
    }
    for (const key of Object.keys(raw)) {
        if (!["rules", "include", "exclude", "properties", "known", "$schema"].includes(key)) throw new ConfigError(where, `unknown option "${key}" (options: rules, include, exclude, properties, known)`)
    }
    out.include = strings("include")
    out.exclude = strings("exclude")
    out.properties = strings("properties")
    out.known = strings("known")
    const rules = (raw as Record<string, unknown>).rules
    if (rules !== undefined) {
        if (!rules || typeof rules !== "object" || Array.isArray(rules)) throw new ConfigError(where, `"rules" must be an object of rule names and levels`)
        for (const [name, level] of Object.entries(rules)) {
            if (typeof level !== "string" || !LEVELS.has(level)) throw new ConfigError(where, `rule "${name}" must be "error", "warning", "info" or "off", not ${JSON.stringify(level)}`)
        }
        out.rules = rules as Record<string, Level>
    }
    return out
}
