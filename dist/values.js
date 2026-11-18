"use strict";
// SPDX-License-Identifier: LGPL-3.0-or-later
//
// Whether a literal argument is a value ForgeScript accepts for its type. Where ForgeScript is
// installed, its own resolvers decide (CompiledFunction.resolve<Type>), so the answer is exactly
// ForgeScript's, for the version the bot has. IDs are checked against its ID pattern: whether the
// thing exists is only known when the bot runs.
Object.defineProperty(exports, "__esModule", { value: true });
exports.ValueChecker = void 0;
/** Types whose resolver needs Discord (fetches by ID): only the ID's shape can be checked. */
const ID_TYPES = new Set(["Message", "Channel", "TextChannel", "User", "RoleOrUser", "Member", "AutomodRule", "ScheduledEvent", "SoundboardSound", "StageInstance", "Invite", "Webhook"]);
/** Looked up in the cache by ID: a name never resolves. */
const CACHE_ID_TYPES = new Set(["Guild", "Role"]);
/** Resolved without Discord: ForgeScript's resolver can run here. */
const PURE_TYPES = new Set(["Number", "Boolean", "Time", "Enum", "Permission", "Color", "URL", "OverwritePermission", "BigInt"]);
class ValueChecker {
    proto;
    self;
    idRegex;
    colors;
    /** @param forgescript The bot's installed ForgeScript module, for its exact resolvers. Without it, a built-in copy of the 2.8.0 rules is used. */
    constructor(forgescript, discord) {
        const cf = forgescript?.CompiledFunction;
        this.proto = cf?.prototype ?? null;
        this.self = this.proto ? Object.create(this.proto) : null;
        this.idRegex = cf?.IdRegex ?? /^(\d{16,23})$/;
        this.colors = discord?.Colors ?? null;
    }
    /**
     * Checks one literal argument. `text` is the argument after escapes, as ForgeScript resolves it.
     * Follows CompiledFunction.resolveArg: an optional argument left empty is not resolved at all.
     */
    check(param, text, fn) {
        const type = param.type;
        if (!type || (!param.required && text === ""))
            return null;
        const refused = (expected) => ({
            severity: "error",
            rule: "invalid-argument",
            message: `${fn}: "${param.name}" must be ${expected}, not ${JSON.stringify(text)}. ForgeScript stops the command: "Given value ${text} for argument ${param.name} is not of type ${type}"`,
        });
        if (ID_TYPES.has(type))
            return this.idRegex.test(text) ? null : refused("an ID (16 to 23 digits)");
        if (CACHE_ID_TYPES.has(type))
            return /^\d+$/.test(text) ? null : refused(`an ID: the ${type.toLowerCase()} is looked up by ID, and a name never matches`);
        if (type === "Enum" && param.enum?.length) {
            if (param.enum.includes(text) || /^\d+$/.test(text))
                return null;
            const other = param.enum.find((v) => v.toLowerCase() === text.toLowerCase());
            return refused(other ? `${other} (letter case matters)` : `one of ${list(param.enum)}`);
        }
        if (!PURE_TYPES.has(type))
            return null;
        const value = this.resolve(type, text, param);
        if (value === NOT_CHECKED)
            return null;
        if (value === undefined) {
            const expected = {
                Number: "a number",
                Boolean: "true or false, in lower case",
                Time: "a duration: milliseconds, or whole numbers with d, h, m, s, w, M or y, like 1h30m (no spaces or decimals)",
                Permission: "a permission name like ManageMessages",
                URL: "an https:// link",
                OverwritePermission: "+, / or - followed by a permission name, like +ViewChannel",
                BigInt: "a whole number",
            };
            return refused(expected[type] ?? `a ${type}`);
        }
        if (type === "URL" && /^http:\/\//i.test(text)) {
            return { severity: "warning", rule: "http-url", message: `${fn}: ForgeScript only accepts https:// links. ${JSON.stringify(text)} is read as an emoji instead, and becomes the broken link ${String(value)}` };
        }
        if (type === "Color")
            return this.color(text, value, fn);
        return null;
    }
    color(text, value, fn) {
        const warn = (message) => ({ severity: "warning", rule: "color-value", message: `${fn}: ${message}` });
        if (text === "Random" || /^#[0-9a-fA-F]{1,6}$/.test(text))
            return null;
        if (this.colors && text in this.colors)
            return null;
        if (!Number.isNaN(Number(text))) {
            // Digits only: read as a decimal number, not as hex.
            if (/^[0-9]{6}$/.test(text) && Number(text) !== parseInt(text, 16))
                return warn(`${text} is read as the decimal number ${Number(text)} (#${Number(text).toString(16).padStart(6, "0")}), not as #${text}. Write #${text}`);
            return null;
        }
        const named = this.colors ? Object.keys(this.colors).find((k) => k.toLowerCase() === text.toLowerCase()) : undefined;
        if (/^[0-9a-fA-F]{1,6}$/.test(text))
            return null;
        if (Number.isNaN(value))
            return warn(`${JSON.stringify(text)} is not a colour, so the embed gets none${named ? `. Colour names are written like ${named}` : ""}`);
        return warn(`${JSON.stringify(text)} is not a colour name, so it is read as hexadecimal up to its first non-hex letter: #${value.toString(16).padStart(6, "0")}${named ? `. Write ${named}` : ""}`);
    }
    resolve(type, text, param) {
        const arg = { name: param.name, required: !!param.required, rest: !!param.rest, enum: undefined };
        const method = this.proto?.[`resolve${type}`];
        if (typeof method === "function") {
            try {
                return method.call(this.self, null, arg, text, []);
            }
            catch {
                // BigInt("x") throws in ForgeScript too, which stops the command: a refusal.
                return undefined;
            }
        }
        // Without ForgeScript: the 2.8.0 rules for the types that do not need discord.js.
        switch (type) {
            case "Number":
                return Number.isNaN(Number(text)) ? undefined : Number(text);
            case "Boolean":
                return text === "true" ? true : text === "false" ? false : undefined;
            case "BigInt":
                try {
                    return BigInt(text);
                }
                catch {
                    return undefined;
                }
            default:
                return NOT_CHECKED;
        }
    }
}
exports.ValueChecker = ValueChecker;
const NOT_CHECKED = Symbol("not checked");
function list(values) {
    return values.length > 8 ? `${values.slice(0, 8).join(", ")}, ...` : values.join(", ");
}
//# sourceMappingURL=values.js.map