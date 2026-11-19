// SPDX-License-Identifier: LGPL-3.0-or-later
/**
 * The child process of {@link probeExtension} (events.ts): reads `{ forgeDir, functions, events }` on
 * stdin, runs each function on stand-in data shaped like each event's, and prints one line of JSON.
 *
 * The stand-in context has only what an event gives (`ctx.runtime.extras`, `ctx.runtime.states`, and
 * `ctx.extendedStates` as an extension's Context reads them): reading anything else stops that run, and
 * its outcome is unknown. Stand-in values give a stand-in for every property, so only missing data (a
 * key the event does not pass) makes a function give nothing or fail with a TypeError.
 */
import type { EventSite, Outcome, ProbeResult, Shape } from "./events"

const UNKNOWN = Symbol("unknown")

class Unknown extends Error {}

/** Something for every property, and "x" as text. */
const any: object = new Proxy(
    {},
    {
        get(_, key) {
            if (key === Symbol.toPrimitive) return () => "x"
            if (key === "toJSON" || key === "toString" || key === "valueOf") return () => "x"
            if (typeof key === "symbol" || key === "then") return undefined
            return any
        },
        has: () => true,
    },
)

function build(shape: Shape | null | undefined): unknown {
    if (shape === undefined) return undefined
    if (shape === null) throw new Unknown()
    if (shape.kind === "string") return shape.value
    if (shape.kind === "any") return any
    if (shape.kind === "none") return undefined
    return Object.fromEntries(Object.entries(shape.keys).map(([k, v]) => [k, build(v)]))
}

/** A context with only `runtime.extras`, `runtime.states` and `extendedStates`. */
function context(extras: unknown, states: unknown): object {
    const guard = (target: Record<string, unknown>) =>
        new Proxy(target, {
            get(t, key) {
                if (typeof key === "symbol" || key === "then") return undefined
                if (key in t) return t[key]
                throw new Unknown()
            },
        })
    return guard({ runtime: guard({ extras, states }), extendedStates: states, noop: () => undefined })
}

async function main() {
    const input = JSON.parse(require("node:fs").readFileSync(0, "utf8")) as {
        forgeDir: string
        packages: Array<{ functions: Array<{ name: string; file: string }>; events: Record<string, EventSite[]> }>
    }
    const forgescript = require(input.forgeDir)
    const { CompiledFunction, ReturnType } = forgescript
    // Two sets of arguments: an error that differs between them depends on the argument, and only
    // its common part is quoted.
    const argsOf = (native: any, variant: number) =>
        (native.data.args ?? []).map((a: any) => {
            if (!a.required) return undefined
            if (a.enum) {
                const keys = Object.keys(a.enum).filter((k) => Number.isNaN(Number(k)))
                const key = keys[Math.min(variant, keys.length - 1)]
                return key === undefined ? undefined : a.enum[key]
            }
            return a.type === forgescript.ArgType?.Number ? 1 + variant : a.type === forgescript.ArgType?.Boolean ? true : variant ? "y" : "x"
        })
    const runOnce = async (native: any, extras: unknown, states: unknown): Promise<Outcome | typeof UNKNOWN> => {
        const a = await runWith(native, extras, states, argsOf(native, 0))
        if (typeof a !== "object") return a
        const b = await runWith(native, extras, states, argsOf(native, 1))
        if (typeof b !== "object") return UNKNOWN
        if (a.crash === b.crash) return a
        let i = 0
        while (i < a.crash.length && a.crash[i] === b.crash[i]) i++
        return { crash: a.crash.slice(0, i).replace(/\s*\([^)]*$/, "").trimEnd() }
    }
    const runWith = async (native: any, extras: unknown, states: unknown, args: unknown[]): Promise<Outcome | typeof UNKNOWN> => {
        const self = Object.create(CompiledFunction.prototype)
        self.data = { negated: false, count: null, fields: [] }
        self.fn = native
        try {
            const ctx = context(extras, states)
            const run = native.data.unwrap ? native.data.execute.call(self, ctx, args) : native.data.execute.call(self, ctx)
            const r = await Promise.race([Promise.resolve(run), new Promise((_, no) => setTimeout(() => no(new Unknown()), 2000))])
            if (!r || (r as any).type !== ReturnType.Success) return UNKNOWN
            const value = (r as any).value
            return value === null || value === undefined || value === "" ? "nothing" : "value"
        } catch (e) {
            if (e instanceof Unknown) return UNKNOWN
            const err = e as Error
            return err instanceof TypeError && /^Cannot read properties of (undefined|null)/.test(err.message) ? { crash: `${err.name}: ${err.message}` } : UNKNOWN
        }
    }
    const run = async (native: any, sites: EventSite[] | null): Promise<Outcome> => {
        // Without event data: as in another package's event.
        if (!sites) {
            const o = await runOnce(native, undefined, undefined)
            return o === UNKNOWN ? "unknown" : o
        }
        if (!sites.length) return "unknown"
        const outcomes: Outcome[] = []
        for (const site of sites) {
            let extras: unknown
            let states: unknown
            try {
                extras = build(site.extras)
                states = build(site.states)
            } catch {
                return "unknown"
            }
            const o = await runOnce(native, extras, states)
            if (o === UNKNOWN) return "unknown"
            outcomes.push(o)
        }
        // Nothing (or a crash) only when every way the event runs a command gives that.
        if (outcomes.some((o) => o === "value")) return "value"
        return outcomes.every((o) => o === "nothing") ? "nothing" : outcomes.find((o) => typeof o === "object") ?? "unknown"
    }

    const results: ProbeResult[] = []
    for (const pkg of input.packages) {
        const result: ProbeResult = {}
        for (const f of pkg.functions) {
            let native: any
            try {
                const exported = require(f.file)
                native = exported?.default ?? exported
            } catch {
                continue
            }
            if (!native?.data?.execute) continue
            const events: Record<string, Outcome> = {}
            for (const [name, sites] of Object.entries(pkg.events)) events[name] = await run(native, sites)
            result[f.name.toLowerCase()] = { none: await run(native, null), events }
        }
        results.push(result)
    }
    // Exit once it is written: a large result to a pipe is written in parts.
    process.stdout.write(JSON.stringify(results) + "\n", () => process.exit(0))
}

main().catch(() => process.exit(1))
