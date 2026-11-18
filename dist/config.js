"use strict";
// SPDX-License-Identifier: LGPL-3.0-or-later
//
// The config: `reforgiparse.config.json` in the bot's folder, or a "reforgiparse" key in its
// package.json. JSON, not JavaScript, so checking a bot never runs code from its config.
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
exports.ConfigError = exports.CONFIG_FILE = void 0;
exports.loadConfig = loadConfig;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
exports.CONFIG_FILE = "reforgiparse.config.json";
const LEVELS = new Set(["error", "warning", "info", "off"]);
class ConfigError extends Error {
    constructor(file, message) {
        super(`${file}: ${message}`);
        this.name = "ConfigError";
    }
}
exports.ConfigError = ConfigError;
/**
 * The config for a bot's folder: `file` when given, else `reforgiparse.config.json` there, else the
 * "reforgiparse" key of its package.json, else none. Throws a ConfigError for a config that cannot
 * be used, so a typo never silently checks with other settings.
 */
function loadConfig(root, file) {
    let where = null;
    let raw;
    if (file) {
        where = path.resolve(root, file);
        raw = readJson(where);
    }
    else if (fs.existsSync(path.join(root, exports.CONFIG_FILE))) {
        where = path.join(root, exports.CONFIG_FILE);
        raw = readJson(where);
    }
    else {
        const pj = path.join(root, "package.json");
        const data = fs.existsSync(pj) ? readJson(pj) : null;
        if (data && data.reforgiparse !== undefined) {
            where = `${pj} ("reforgiparse")`;
            raw = data.reforgiparse;
        }
    }
    if (!where)
        return { config: {}, file: null };
    return { config: validate(raw, where), file: where };
}
function readJson(file) {
    let text;
    try {
        text = fs.readFileSync(file, "utf8");
    }
    catch {
        throw new ConfigError(file, "cannot be read");
    }
    try {
        return JSON.parse(text);
    }
    catch (e) {
        throw new ConfigError(file, `is not valid JSON (${e.message})`);
    }
}
function validate(raw, where) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
        throw new ConfigError(where, "must be an object");
    const out = {};
    const strings = (key) => {
        const v = raw[key];
        if (v === undefined)
            return undefined;
        const list = typeof v === "string" ? [v] : v;
        if (!Array.isArray(list) || !list.every((x) => typeof x === "string"))
            throw new ConfigError(where, `"${key}" must be a string or a list of strings`);
        return list;
    };
    for (const key of Object.keys(raw)) {
        if (!["rules", "include", "exclude", "properties", "known", "$schema"].includes(key))
            throw new ConfigError(where, `unknown option "${key}" (options: rules, include, exclude, properties, known)`);
    }
    out.include = strings("include");
    out.exclude = strings("exclude");
    out.properties = strings("properties");
    out.known = strings("known");
    const rules = raw.rules;
    if (rules !== undefined) {
        if (!rules || typeof rules !== "object" || Array.isArray(rules))
            throw new ConfigError(where, `"rules" must be an object of rule names and levels`);
        for (const [name, level] of Object.entries(rules)) {
            if (typeof level !== "string" || !LEVELS.has(level))
                throw new ConfigError(where, `rule "${name}" must be "error", "warning", "info" or "off", not ${JSON.stringify(level)}`);
        }
        out.rules = rules;
    }
    return out;
}
//# sourceMappingURL=config.js.map