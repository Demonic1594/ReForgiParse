"use strict"
// `npm run every-function`: every ForgeScript function on ForgeScript's interpreter, against
// ReForgiParse. For each argument ForgeScript checks, in the order it does, a value its resolver
// refuses, and a required argument left out: both must agree on whether, and why, the command stops.
// An argument after one that needs Discord to pass (a real channel) cannot be reached here; its type is
// covered by test/every-function.test.js. Functions that touch files, the shell, HTTP or websockets are
// left out, and every run happens in an empty temporary folder. Takes a few minutes.
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { spawn } = require("node:child_process")
const forgescript = require("@tryforge/forgescript")
const discord = require("discord.js")
const { FunctionTable, ValueChecker, checkCode } = require("../..")

forgescript.FunctionManager.loadNative()
const table = FunctionTable.fromForgeScript(forgescript)
const values = new ValueChecker(forgescript, discord)
const UNSAFE = /[\\/]native[\\/](unsafe|fs|http|websocket)[\\/]/
const SKIP = new Set(["$botdestroy", "$exec", "$wait", "$setstatus"])
const GOOD = { String: "x", Number: "1", Boolean: "true", Time: "1s", Permission: "Administrator", Color: "#ffffff", URL: "https://example.com/a.png", BigInt: "1", OverwritePermission: "+ViewChannel", Json: "{}", Date: "1" }
const BAD = { Number: "abc", Boolean: "maybe", Time: "1.5h", Enum: "Nope", Permission: "Nope", BigInt: "1.5", URL: "nope", OverwritePermission: "Nope", Channel: "abc", TextChannel: "abc", User: "abc", Member: "abc", Message: "abc", Guild: "abc", Role: "abc", Webhook: "abc", Emoji: "abc", ApplicationEmoji: "abc", Sticker: "abc", GuildEmoji: "abc", Invite: "abc", RoleOrUser: "abc", AutomodRule: "abc", ScheduledEvent: "abc", SoundboardSound: "abc", StageInstance: "abc", ForumTag: "abc" }
const good = (p) => (p.type === "Enum" ? (p.enumObject ? Object.keys(p.enumObject).find((k) => Number.isNaN(Number(k))) : p.enum?.[0]) : p.condition ? "1==1" : GOOD[p.type ?? "String"])

const cases = []
for (const fn of table.functions) {
    if (fn.package !== "@tryforge/forgescript" || !fn.params?.length || !fn.args) continue
    const native = forgescript.FunctionManager.get(fn.name)
    if (!native || UNSAFE.test(native.path ?? "") || SKIP.has(fn.name.toLowerCase())) continue
    const order = fn.unwrap ? fn.params.map((_, i) => i) : fn.resolved ?? []
    const filled = fn.params.map((p) => good(p) ?? null)
    const lastRequired = Math.max(...fn.params.map((q, j) => (q.required ? j : -1)))
    for (const [k, i] of order.entries()) {
        const p = fn.params[i]
        if (order.slice(0, k).some((j) => filled[j] === null)) break
        const args = (fill) => fn.params.map((q, j) => (j === i ? fill : filled[j] ?? "x"))
        if (BAD[p.type]) cases.push({ fn: fn.name, arg: p.name, kind: "refused", code: `${fn.name}[${args(BAD[p.type]).slice(0, Math.max(i, lastRequired) + 1).join(";")}]` })
        if (p.required && !p.rest && i === lastRequired && i > 0) cases.push({ fn: fn.name, arg: p.name, kind: "missing", code: `${fn.name}[${args("").slice(0, i).join(";")}]` })
    }
}

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "reforgiparse-every-"))
const run = (code) =>
    new Promise((resolve) => {
        const child = spawn(process.execPath, [path.join(__dirname, "run-code.js"), code], { cwd: sandbox, env: { ...process.env, NODE_PATH: path.join(__dirname, "..", "..", "node_modules") } })
        let out = ""
        child.stdout.on("data", (d) => (out += d))
        const timer = setTimeout(() => child.kill("SIGKILL"), 20000)
        child.on("exit", () => {
            clearTimeout(timer)
            try {
                resolve(JSON.parse(out))
            } catch {
                resolve({ hang: true })
            }
        })
    })

;(async () => {
    let next = 0
    const tally = { agree: 0, disagree: 0, discord: 0 }
    const diffs = []
    await Promise.all(
        Array.from({ length: Math.max(2, os.cpus().length) }, async () => {
            while (next < cases.length) {
                const c = cases[next++]
                const theirs = await run(c.code)
                const err = theirs.error ?? ""
                if (!/for argument|missing argument/.test(err) && /token|Cannot read properties of (null|undefined)|fetch failed/i.test(err)) {
                    tally.discord++
                    continue
                }
                const ours = checkCode(c.code, table, { values, customFunction: true }).filter((f) => f.rule === "invalid-argument" || f.rule === "too-few-arguments")
                const theyStop = c.kind === "refused" ? err.includes(`for argument ${c.arg} is not of type`) : err.includes(`missing argument ${c.arg}`)
                const weSay = ours.some((f) => (c.kind === "refused" ? f.message.includes(`argument ${c.arg} is not of type`) : f.message.includes(`missing argument ${c.arg}`)))
                if (theyStop === weSay) tally.agree++
                else {
                    tally.disagree++
                    diffs.push(`${c.kind} ${c.code}\n    ForgeScript: ${JSON.stringify(theirs)}\n    ReForgiParse: ${JSON.stringify(ours.map((f) => f.message))}`)
                }
            }
        }),
    )
    console.log(`${cases.length} runs on ForgeScript ${require("@tryforge/forgescript/package.json").version}: ${tally.agree} agree, ${tally.disagree} disagree, ${tally.discord} need Discord`)
    for (const d of diffs) console.log(d)
    fs.rmSync(sandbox, { recursive: true, force: true })
    process.exitCode = tally.disagree ? 1 : 0
})()
