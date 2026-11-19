"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const UNKNOWN = Symbol("unknown");
class Unknown extends Error {
}
/** Something for every property, and "x" as text. */
const any = new Proxy({}, {
    get(_, key) {
        if (key === Symbol.toPrimitive)
            return () => "x";
        if (key === "toJSON" || key === "toString" || key === "valueOf")
            return () => "x";
        if (typeof key === "symbol" || key === "then")
            return undefined;
        return any;
    },
    has: () => true,
});
function build(shape) {
    if (shape === undefined)
        return undefined;
    if (shape === null)
        throw new Unknown();
    if (shape.kind === "string")
        return shape.value;
    if (shape.kind === "any")
        return any;
    if (shape.kind === "none")
        return undefined;
    return Object.fromEntries(Object.entries(shape.keys).map(([k, v]) => [k, build(v)]));
}
/** A context with only `runtime.extras`, `runtime.states` and `extendedStates`. */
function context(extras, states) {
    const guard = (target) => new Proxy(target, {
        get(t, key) {
            if (typeof key === "symbol" || key === "then")
                return undefined;
            if (key in t)
                return t[key];
            throw new Unknown();
        },
    });
    return guard({ runtime: guard({ extras, states }), extendedStates: states, noop: () => undefined });
}
async function main() {
    const input = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
    const forgescript = require(input.forgeDir);
    const { CompiledFunction, ReturnType } = forgescript;
    // Two sets of arguments: an error that differs between them depends on the argument, and only
    // its common part is quoted.
    const argsOf = (native, variant) => (native.data.args ?? []).map((a) => {
        if (!a.required)
            return undefined;
        if (a.enum) {
            const keys = Object.keys(a.enum).filter((k) => Number.isNaN(Number(k)));
            const key = keys[Math.min(variant, keys.length - 1)];
            return key === undefined ? undefined : a.enum[key];
        }
        return a.type === forgescript.ArgType?.Number ? 1 + variant : a.type === forgescript.ArgType?.Boolean ? true : variant ? "y" : "x";
    });
    const runOnce = async (native, extras, states) => {
        const a = await runWith(native, extras, states, argsOf(native, 0));
        if (typeof a !== "object")
            return a;
        const b = await runWith(native, extras, states, argsOf(native, 1));
        if (typeof b !== "object")
            return UNKNOWN;
        if (a.crash === b.crash)
            return a;
        let i = 0;
        while (i < a.crash.length && a.crash[i] === b.crash[i])
            i++;
        return { crash: a.crash.slice(0, i).replace(/\s*\([^)]*$/, "").trimEnd() };
    };
    const runWith = async (native, extras, states, args) => {
        const self = Object.create(CompiledFunction.prototype);
        self.data = { negated: false, count: null, fields: [] };
        self.fn = native;
        try {
            const ctx = context(extras, states);
            const run = native.data.unwrap ? native.data.execute.call(self, ctx, args) : native.data.execute.call(self, ctx);
            const r = await Promise.race([Promise.resolve(run), new Promise((_, no) => setTimeout(() => no(new Unknown()), 2000))]);
            if (!r || r.type !== ReturnType.Success)
                return UNKNOWN;
            const value = r.value;
            return value === null || value === undefined || value === "" ? "nothing" : "value";
        }
        catch (e) {
            if (e instanceof Unknown)
                return UNKNOWN;
            const err = e;
            return err instanceof TypeError && /^Cannot read properties of (undefined|null)/.test(err.message) ? { crash: `${err.name}: ${err.message}` } : UNKNOWN;
        }
    };
    const run = async (native, sites) => {
        // Without event data: as in another package's event.
        if (!sites) {
            const o = await runOnce(native, undefined, undefined);
            return o === UNKNOWN ? "unknown" : o;
        }
        if (!sites.length)
            return "unknown";
        const outcomes = [];
        for (const site of sites) {
            let extras;
            let states;
            try {
                extras = build(site.extras);
                states = build(site.states);
            }
            catch {
                return "unknown";
            }
            const o = await runOnce(native, extras, states);
            if (o === UNKNOWN)
                return "unknown";
            outcomes.push(o);
        }
        // Nothing (or a crash) only when every way the event runs a command gives that.
        if (outcomes.some((o) => o === "value"))
            return "value";
        return outcomes.every((o) => o === "nothing") ? "nothing" : outcomes.find((o) => typeof o === "object") ?? "unknown";
    };
    const results = [];
    for (const pkg of input.packages) {
        const result = {};
        for (const f of pkg.functions) {
            let native;
            try {
                const exported = require(f.file);
                native = exported?.default ?? exported;
            }
            catch {
                continue;
            }
            if (!native?.data?.execute)
                continue;
            const events = {};
            for (const [name, sites] of Object.entries(pkg.events))
                events[name] = await run(native, sites);
            result[f.name.toLowerCase()] = { none: await run(native, null), events };
        }
        results.push(result);
    }
    // Exit once it is written: a large result to a pipe is written in parts.
    process.stdout.write(JSON.stringify(results) + "\n", () => process.exit(0));
}
main().catch(() => process.exit(1));
//# sourceMappingURL=probe.js.map