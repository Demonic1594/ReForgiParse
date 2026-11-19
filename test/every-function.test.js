"use strict"
// Every function ForgeScript has, and every argument type it reads, against ForgeScript itself:
// - each name and alias, with no brackets, empty brackets and one to one-too-many arguments, compiles
//   to the same error (message, line, column) as ForgeScript's compiler;
// - each ArgType's own resolver (CompiledFunction.resolve<Type>), on many values, refuses exactly the
//   ones ReForgiParse reports, given a client that has an object for any ID-shaped key (whether a
//   particular thing exists is only known when the bot runs).
const { test } = require("node:test")
const assert = require("node:assert/strict")
const forgescript = require("@tryforge/forgescript")
const discord = require("discord.js")
const { FunctionTable, parse, ValueChecker } = require("..")

forgescript.FunctionManager.loadNative()
const table = FunctionTable.fromForgeScript(forgescript)

test("every function name and alias, with every argument count: the same compile error as ForgeScript", () => {
    const theirs = (code) => {
        try {
            new forgescript.Compiler(undefined, code).compile()
            return null
        } catch (e) {
            const m = /^> \*\*`(.*)`\*\* at \*\*`(\d+)`\*\*:\*\*`(\d+)`\*\*/.exec(e.message)
            return m ? `${m[1]} @${m[2]}:${m[3]}` : e.message
        }
    }
    const ours = (code) => {
        try {
            parse(code, table)
            return null
        } catch (e) {
            return `${e.message} @${e.line}:${e.column}`
        }
    }
    let cases = 0
    for (const [key, fn] of table.byKey) {
        const n = (fn.args?.fields.length ?? 0) + 1
        for (const code of [key, `${key}[]`, ...Array.from({ length: n }, (_, k) => `${key}[${Array(k + 1).fill("a").join(";")}]`)]) {
            cases++
            assert.equal(ours(code), theirs(code), code)
        }
    }
    assert.ok(cases > 5000, `${cases} cases`)
})

test("every argument type: ForgeScript's resolver and ReForgiParse refuse the same values", async () => {
    const values = new ValueChecker(forgescript, discord)
    const CF = forgescript.CompiledFunction
    const self = Object.create(CF.prototype)
    const SAMPLES = ["x", "abc", "1", "0", "-1", "1.5", "1e3", "0x10", " 2 ", "Infinity", "NaN", "true", "false", "True", "1h", "1h30m", "1.5h", "1 h", "2d", "Administrator", "administrator", "+ViewChannel", "-SendMessages", "/ViewChannel", "+viewchannel", "Nope", "#fff", "#ffffff", "ff0000", "blue", "Blue", "Random", "123456", "https://example.com/a.png", "http://example.com/a.png", "<:smile:123456789012345678>", "<a:dance:123456789012345678>", "123456789012345678", "12345678901234567890123", "123456789012345", "😀", "smile", "https://cdn.discordapp.com/emojis/123456789012345678.png", "https://cdn.discordapp.com/stickers/123456789012345678.png", "{}", "{bad"]
    const has = (k) => (/^\d+$/.test(String(k)) ? { id: k, messages: {} } : undefined)
    const store = { cache: { get: has }, fetch: async (k) => has(k) }
    const guild = { roles: store, members: store, autoModerationRules: store, scheduledEvents: store, soundboardSounds: store, stageInstances: store, emojis: store }
    const ctx = {
        noop: () => undefined,
        client: { channels: { ...store, fetch: async (k) => ({ id: k, messages: {} }) }, users: store, guilds: { cache: { get: (k) => (has(k) ? guild : undefined) } }, emojis: store, application: { emojis: store }, fetchSticker: async (k) => has(k), fetchInvite: async (k) => has(k), fetchWebhook: async (k) => has(k), fetchGuildTemplate: async () => ({}) },
        guild,
        channel: { availableTags: { find: (f) => (SAMPLES.filter((s) => /^\d+$/.test(s)).some((id) => f({ id })) ? {} : undefined) }, messages: store },
        message: { fetch: async () => ({ reactions: { cache: { get: () => ({}) } } }) },
    }
    // Not reported on purpose: an Attachment link with the scheme "htts://", which ForgeScript's URL pattern lets through and fetch then fails on.
    const KNOWN = new Set(["Attachment htts://x"])
    const differ = []
    for (const type of Object.keys(forgescript.ArgType).filter((k) => Number.isNaN(Number(k)))) {
        const method = CF.prototype[`resolve${type}`]
        if (typeof method !== "function") continue
        const enumObject = discord.ButtonStyle
        const param = { name: "arg", type, required: true, ...(type === "Enum" ? { enum: Object.keys(enumObject).filter((k) => Number.isNaN(Number(k))), enumObject } : {}) }
        for (const text of [...SAMPLES, "htts://x"]) {
            let resolved
            try {
                resolved = await method.call(self, ctx, { name: "arg", required: true, enum: type === "Enum" ? enumObject : undefined }, text, [])
            } catch {
                resolved = undefined
            }
            const refused = resolved === undefined
            const reported = values.check(param, text, "$f")?.rule === "invalid-argument"
            if (refused !== reported && !KNOWN.has(`${type} ${text}`)) differ.push(`${type} ${JSON.stringify(text)}: ForgeScript ${refused ? "refuses" : "accepts"}`)
        }
    }
    assert.deepEqual(differ, [])
})
