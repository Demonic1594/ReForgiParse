// SPDX-License-Identifier: LGPL-3.0-or-later
//
// Whether a literal argument is a value ForgeScript accepts for its type. Where ForgeScript is
// installed, its own resolvers decide (CompiledFunction.resolve<Type>), so the answer is exactly
// ForgeScript's, for the version the bot has. IDs are checked against its ID pattern: whether the
// thing exists is only known when the bot runs.

import { IParam } from "./table"

/** Why a value is refused or misread, or `null` when it is fine. */
export interface ValueProblem {
    severity: "error" | "warning"
    /** `invalid-argument`, `color-value` or `http-url`. */
    rule: "invalid-argument" | "color-value" | "http-url"
    message: string
}

/** Types whose resolver needs Discord (fetches by ID): only the ID's shape can be checked. */
const ID_TYPES = new Set(["Message", "Channel", "TextChannel", "User", "RoleOrUser", "Member", "AutomodRule", "ScheduledEvent", "SoundboardSound", "StageInstance", "Invite", "Webhook"])
/** Looked up in the cache by ID: a name never resolves. */
const CACHE_ID_TYPES = new Set(["Guild", "Role", "ForumTag"])
/** Fetched by ID, also given as a CDN link (and for emojis as <:name:ID>): CompiledFunction.resolveSticker, resolveEmoji. */
const MEDIA_TYPES = new Set(["Sticker", "Emoji", "ApplicationEmoji", "GuildEmoji"])
/** Resolved without Discord: ForgeScript's resolver can run here. */
const PURE_TYPES = new Set(["Number", "Boolean", "Time", "Enum", "Permission", "Color", "URL", "OverwritePermission", "BigInt"])

interface ForgeScriptValues {
    Conditions?: Record<string, (lhs: string, rhs: string | null) => boolean>
    CompiledFunction?: { prototype: Record<string, any>; IdRegex?: RegExp; URLRegex?: RegExp; CDNIdRegex?: RegExp }
}

export class ValueChecker {
    private readonly proto: Record<string, any> | null
    private readonly self: object | null
    private readonly idRegex: RegExp
    private readonly cdnRegex: RegExp
    private readonly parseEmoji: (text: string) => { id?: string | null } | null
    private readonly colors: Record<string, number> | null
    private readonly conditions: Record<string, (lhs: string, rhs: string | null) => boolean> | null

    /** @param forgescript The bot's installed ForgeScript module, for its exact resolvers. Without it, a built-in copy of the 2.8.0 rules is used. */
    constructor(forgescript?: ForgeScriptValues | null, discord?: { Colors?: Record<string, number>; parseEmoji?: (text: string) => { id?: string | null } | null } | null) {
        const cf = forgescript?.CompiledFunction
        this.proto = cf?.prototype ?? null
        this.self = this.proto ? Object.create(this.proto) : null
        this.idRegex = cf?.IdRegex ?? /^(\d{16,23})$/
        this.cdnRegex = cf?.CDNIdRegex ?? /https?:\/\/cdn\.discordapp\.com\/(emojis|stickers)\/(\d+)/
        this.parseEmoji = discord?.parseEmoji ?? ((text) => ({ id: /^<a?:\w+:(\d+)>$/.exec(text)?.[1] ?? null }))
        this.colors = discord?.Colors ?? null
        this.conditions = forgescript?.Conditions ?? null
    }

    /** What ForgeScript's `Conditions` (core/Compiler.js) gives for fixed text: `null` without ForgeScript. */
    condition(op: string, lhs: string, rhs: string | null): boolean | null {
        const fn = this.conditions?.[op]
        return fn ? !!fn(lhs, rhs) : null
    }

    /**
     * Checks one literal argument. `text` is the argument after escapes, as ForgeScript resolves it.
     * Follows CompiledFunction.resolveArg: an optional argument left empty is not resolved at all.
     */
    check(param: IParam, text: string, fn: string): ValueProblem | null {
        const type = param.type
        if (!type || (!param.required && text === "")) return null
        const refused = (expected: string): ValueProblem => ({
            severity: "error",
            rule: "invalid-argument",
            message: `${fn}: "${param.name}" ${text === "" ? `is empty, but must be ${expected}` : `must be ${expected}, not ${JSON.stringify(text)}`}. ForgeScript stops the command: "Given value ${text} for argument ${param.name} is not of type ${type}"`,
        })

        if (ID_TYPES.has(type)) return this.idRegex.test(text) ? null : refused("an ID (16 to 23 digits)")
        if (MEDIA_TYPES.has(type)) {
            if (this.cdnRegex.test(text)) return null
            // A sticker is only an ID or its link (resolveSticker); emojis are also read as <:name:ID>.
            const id = type === "Sticker" ? text : this.parseEmoji(text)?.id ?? text
            // GuildEmoji is looked up in the cache, which has only IDs; the others are fetched by an ID's shape.
            const ok = type === "GuildEmoji" ? /^\d+$/.test(id) : this.idRegex.test(id)
            if (ok) return null
            return refused(type === "Sticker" ? "a sticker's ID or its link: a name is not looked up" : "a custom emoji (<:name:ID>), its ID or its link: a unicode emoji or a name is not looked up")
        }
        if (CACHE_ID_TYPES.has(type)) return /^\d+$/.test(text) ? null : refused(`an ID: the ${type.toLowerCase()} is looked up by ID, and a name never matches`)
        if (type === "Enum" && param.enum?.length) {
            // CompiledFunction.resolveEnum: arg.enum[text]. A number is a value only where the enum has it.
            if (param.enumObject ? param.enumObject[text] !== undefined : param.enum.includes(text) || /^\d+$/.test(text)) return null
            const other = param.enum.find((v) => v.toLowerCase() === text.toLowerCase())
            return refused(other ? `${other} (letter case matters)` : `one of ${list(param.enum)}`)
        }
        if (!PURE_TYPES.has(type)) return null

        // BigInt(text) throws in ForgeScript's resolver: that error, not the usual one, is what it logs.
        if (type === "BigInt") {
            try {
                BigInt(text)
            } catch (e) {
                return { severity: "error", rule: "invalid-argument", message: `${fn}: "${param.name}" must be a whole number, not ${JSON.stringify(text)}. ForgeScript stops the command: "${(e as Error).name}: ${(e as Error).message}"` }
            }
            return null
        }
        const value = this.resolve(type, text, param)
        if (value === NOT_CHECKED) return null
        if (value === undefined) {
            const expected: Record<string, string> = {
                Number: "a number",
                Boolean: "true or false, in lower case",
                Time: "a duration: milliseconds, or whole numbers with d, h, m, s, w, M or y, like 1h30m (no spaces or decimals)",
                Permission: "a permission name like ManageMessages",
                URL: "an https:// link",
                OverwritePermission: "+, / or - followed by a permission name, like +ViewChannel",
                BigInt: "a whole number",
            }
            return refused(expected[type] ?? `a ${type}`)
        }
        if (type === "URL" && /^http:\/\//i.test(text)) {
            return { severity: "warning", rule: "http-url", message: `${fn}: ForgeScript only accepts https:// links. ${JSON.stringify(text)} is read as an emoji instead, and becomes the broken link ${String(value)}` }
        }
        if (type === "Color") return this.color(text, value as number, fn)
        return null
    }

    private color(text: string, value: number, fn: string): ValueProblem | null {
        const warn = (message: string): ValueProblem => ({ severity: "warning", rule: "color-value", message: `${fn}: ${message}` })
        if (text === "Random" || /^#[0-9a-fA-F]{1,6}$/.test(text)) return null
        if (this.colors && text in this.colors) return null
        if (!Number.isNaN(Number(text))) {
            // Digits only: read as a decimal number, not as hex.
            if (/^[0-9]{6}$/.test(text) && Number(text) !== parseInt(text, 16)) return warn(`${text} is read as the decimal number ${Number(text)} (#${Number(text).toString(16).padStart(6, "0")}), not as #${text}. Write #${text}`)
            return null
        }
        const named = this.colors ? Object.keys(this.colors).find((k) => k.toLowerCase() === text.toLowerCase()) : undefined
        if (/^[0-9a-fA-F]{1,6}$/.test(text)) return null
        if (Number.isNaN(value)) return warn(`${JSON.stringify(text)} is not a colour, so the embed gets none${named ? `. Colour names are written like ${named}` : ""}`)
        return warn(`${JSON.stringify(text)} is not a colour name, so it is read as hexadecimal up to its first non-hex letter: #${value.toString(16).padStart(6, "0")}${named ? `. Write ${named}` : ""}`)
    }

    private resolve(type: string, text: string, param: IParam): unknown {
        const arg = { name: param.name, required: !!param.required, rest: !!param.rest, enum: undefined as unknown }
        const method = this.proto?.[`resolve${type}`]
        if (typeof method === "function") {
            try {
                return method.call(this.self, null, arg, text, [])
            } catch {
                // BigInt("x") throws in ForgeScript too, which stops the command: a refusal.
                return undefined
            }
        }
        // Without ForgeScript: the 2.8.0 rules for the types that do not need discord.js.
        switch (type) {
            case "Number":
                return Number.isNaN(Number(text)) ? undefined : Number(text)
            case "Boolean":
                return text === "true" ? true : text === "false" ? false : undefined
            case "BigInt":
                try {
                    return BigInt(text)
                } catch {
                    return undefined
                }
            default:
                return NOT_CHECKED
        }
    }
}

const NOT_CHECKED = Symbol("not checked")

function list(values: readonly string[]) {
    return values.length > 8 ? `${values.slice(0, 8).join(", ")}, ...` : values.join(", ")
}
