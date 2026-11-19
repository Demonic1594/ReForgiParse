// SPDX-License-Identifier: LGPL-3.0-or-later
//
// Problems in one string of ForgeScript code, found on the parse tree. Every rule states what
// ForgeScript does with the code, checked in its source (2.8.0) or by running its own resolvers,
// so a message is a fact about the bot, not a style opinion.

import { nameIssues } from "./names"
import { AnyField, Call, CompileError, Field, Operators, parse, ParseResult, walk } from "./parser"
import { FunctionTable, IParam, IRawFunction, usage } from "./table"
import { ValueChecker } from "./values"

export type Severity = "error" | "warning" | "info"

/** A problem in a string of code. Offsets are into that string. */
export interface Finding {
    rule: Rule
    severity: Severity
    message: string
    start: number
    end: number
}

/** What each rule finds, and its severity. */
export const Rules = {
    "missing-brackets": { severity: "error", description: "A function that needs brackets has none. ForgeScript refuses to compile the code." },
    "too-many-arguments": { severity: "error", description: "More arguments than the function takes. ForgeScript refuses to compile the code." },
    "unclosed-bracket": { severity: "error", description: "A `[` that is never closed. ForgeScript refuses to compile the code." },
    "too-few-arguments": { severity: "error", description: "A required argument is missing: the command stops (\"Function $x is missing argument y\")." },
    "invalid-argument": { severity: "error", description: "An argument ForgeScript cannot read as its type: the command stops (\"Given value ... is not of type ...\")." },
    "unexpected-brackets": { severity: "warning", description: "Brackets after a function that takes no arguments: they and their text are printed." },
    "incomplete-call": { severity: "warning", description: "A function without a required argument that ForgeScript does not check for (`$if[condition]`): it runs, and does nothing, always stops, or never ends." },
    "unknown-function": { severity: "warning", description: "A `$name` that is no function here, so it is printed as text." },
    "glued-name": { severity: "warning", description: "A `$name` whose start is another function: that one runs, and the rest is printed." },
    "misplaced-operator": { severity: "warning", description: "`!`, `#` or `@[...]` in the wrong order, or before another `$`: the call is printed as text." },
    "condition-operator": { severity: "warning", description: "A condition ForgeScript reads differently: a second operator, `&&` or `||`, or no operator at all." },
    "condition-value": { severity: "warning", description: "A condition that is false whatever the values: spaces around `==`, a word compared with `<`, `$isBot==True`, or spaces around a condition with no operator." },
    "constant-condition": { severity: "info", description: "A condition with fixed text on each side (`$if[1==1;...]`, `$if[false;...]`): always true or always false, so one branch never runs." },
    "unreachable-code": { severity: "warning", description: "Code after `$stop`, `$break`, `$continue` or `$return` in the same block (or in an argument before it): it never runs." },
    "unescaped-bracket": { severity: "warning", description: "A `]` meant for a `[` in the text closes the function instead; the rest is printed." },
    "misplaced-statement": { severity: "error", description: "`$break` or `$continue` outside `$loop` and `$while`, `$return` in a command, or `$ifx` without an `$if`: ForgeScript stops the command." },
    "missing-context": { severity: "warning", description: "A function that reads what the command's event does not give (`$option` in a `messageCreate` command): it gives nothing." },
    "misplaced-branch": { severity: "warning", description: "`$else`, `$elseIf` or `$case` outside `$ifx` or `$switch` (it runs every time), or code in `$ifx` or `$switch` that is no branch of it (it never runs)." },
    "stray-bracket": { severity: "warning", description: "A `]` outside any function that no `[` before it opened: it closes nothing and is printed." },
    "color-value": { severity: "warning", description: "A colour ForgeScript reads differently from what was meant (`blue`, `123456`)." },
    "http-url": { severity: "warning", description: "An `http://` link: ForgeScript only accepts `https://`, and turns it into a broken link." },
    "unused-variable": { severity: "warning", description: "`$let` of a variable nothing in the code reads." },
    "hidden-output": { severity: "info", description: "`$let[x;$fn]` that is never read, only to hide `$fn`'s output: `$!fn` does that." },
    "unset-variable": { severity: "warning", description: "`$get` of a variable nothing in the code sets: always empty." },
    "wrong-store": { severity: "warning", description: "`$get` of a value only `$env` can read, or `$env` of a `$let` variable: always empty." },
    deprecated: { severity: "warning", description: "A function its package marks as deprecated." },
    "escaped-letter": { severity: "info", description: "`\\n` (or another letter) inside an argument is just the letter: the backslash is dropped." },
    "function-case": { severity: "info", description: "A name in other letter case than declared. It works; the declared spelling is easier to search." },
} as const satisfies Record<string, { severity: Severity; description: string }>

export type Rule = keyof typeof Rules

export interface CheckOptions {
    /** Checks literal argument values. Without it, only the rules that need no ForgeScript run. */
    values?: ValueChecker
    /** The code is a custom function's body: it can read the caller's `$let` variables. */
    customFunction?: boolean
    /** What the command's event gives its code, when known: see {@link EventModel}. */
    event?: EventModel
}

/** What an event gives a command's code, read from ForgeScript's handler for it. */
export interface EventModel {
    name: string
    /** The packages with an event of this name: `@tryforge/forgescript`, or an extension. */
    packages: readonly string[]
    /** An interaction (interactionCreate), or maybe one (an extension's event). */
    interaction: boolean
    /** The states it sets: `message`, `member`, ... `null` when they cannot be read from its source. */
    states: ReadonlySet<string> | null
    /** A message command's words ($message). */
    words: boolean
}

const COMPILE_RULE: Record<CompileError["kind"], Rule> = {
    "requires-brackets": "missing-brackets",
    "too-many-args": "too-many-arguments",
    "missing-closure": "unclosed-bracket",
}

/** Code that runs in a copy of the caller's variables, or code nobody can see from here. */
const OPAQUE = new Set(["$eval", "$djseval", "$callfunction", "$calllocalfunction", "$scope", "$settimeout", "$setinterval", "$awaitcomponent", "$awaitmodalsubmit", "$coroutine"])

/** What leaving out a required argument does, for a function that reads its own arguments. */
export interface UncheckedArgument {
    /** The argument's position. */
    arg: number
    /**
     * `stops`: ForgeScript's own check stops the command. `crashes`: an internal error stops it.
     * `runs`: the function runs without it. `always-stops`: it always stops the command, with no error.
     * `never-ends`: the command never finishes.
     */
    outcome: "stops" | "crashes" | "runs" | "always-stops" | "never-ends"
    /** For `runs`: what the function then does. */
    does?: string
    /** For `crashes`: the property ForgeScript's TypeError names. */
    reads?: string
    /** A call that leaves the argument out, run on ForgeScript's interpreter by the tests. */
    example: string
}

/**
 * ForgeScript's functions that read their own arguments (not `unwrap`), so that a required one left
 * out is not caught by ForgeScript's usual check: what each does without it. Each entry is run on
 * ForgeScript's interpreter by test/runtime.test.js. Functions whose outcome needs Discord to show
 * are left out.
 */
export const UncheckedArguments: Record<string, UncheckedArgument> = {
    $cooldown: { arg: 1, outcome: "stops", example: "$cooldown[daily]" },
    $usercooldown: { arg: 1, outcome: "stops", example: "$userCooldown[123456789012345678]" },
    $guildcooldown: { arg: 1, outcome: "stops", example: "$guildCooldown[123456789012345678]" },
    $channelcooldown: { arg: 1, outcome: "stops", example: "$channelCooldown[123456789012345678]" },
    $membercooldown: { arg: 2, outcome: "stops", example: "$memberCooldown[123456789012345678;123456789012345678]" },
    $wssend: { arg: 1, outcome: "stops", example: "$wsSend[123456789012345678]" },
    $arrayfilter: { arg: 2, outcome: "crashes", reads: "lhs", example: "$arrayLoad[a;,;1,2]$arrayFilter[a;v]" },
    $arrayfind: { arg: 2, outcome: "crashes", reads: "lhs", example: "$arrayLoad[a;,;1,2]$arrayFind[a;v]" },
    $arrayfindindex: { arg: 2, outcome: "crashes", reads: "lhs", example: "$arrayLoad[a;,;1,2]$arrayFindIndex[a;v]" },
    $arrayfindlast: { arg: 2, outcome: "crashes", reads: "lhs", example: "$arrayLoad[a;,;1,2]$arrayFindLast[a;v]" },
    $arrayfindlastindex: { arg: 2, outcome: "crashes", reads: "lhs", example: "$arrayLoad[a;,;1,2]$arrayFindLastIndex[a;v]" },
    $arraysome: { arg: 2, outcome: "crashes", reads: "lhs", example: "$arrayLoad[a;,;1,2]$arraySome[a;v]" },
    $switch: { arg: 1, outcome: "crashes", reads: "functions", example: "$switch[x]" },
    $if: { arg: 1, outcome: "runs", does: "checks the condition, running any function in it, and then runs nothing", example: "$if[1==1]" },
    $elseif: { arg: 1, outcome: "runs", does: "checks the condition, running any function in it, and then runs nothing", example: "$elseIf[1==1]" },
    $loop: { arg: 1, outcome: "runs", does: "repeats nothing", example: "$loop[2]" },
    $arrayforeach: { arg: 2, outcome: "runs", does: "runs nothing for the elements", example: "$arrayLoad[a;,;1,2]$arrayForEach[a;v]" },
    $arraymap: { arg: 2, outcome: "runs", does: "runs nothing for the elements, and gives an empty array", example: "$arrayLoad[a;,;1,2]$arrayMap[a;v]" },
    $arrayevery: { arg: 2, outcome: "runs", does: "runs nothing for the elements, and gives false", example: "$arrayLoad[a;,;1,2]$arrayEvery[a;v]" },
    $arrayreduce: { arg: 3, outcome: "runs", does: "runs nothing for the elements", example: "$arrayLoad[a;,;1,2]$arrayReduce[a;x;y]" },
    $arrayadvancedsort: { arg: 3, outcome: "runs", does: "compares nothing, so the order stays as it is", example: "$arrayLoad[a;,;1,2]$arrayAdvancedSort[a;x;y]" },
    $localfunction: { arg: 1, outcome: "runs", does: "defines a function with no code", example: "$localFunction[f]" },
    $while: { arg: 1, outcome: "never-ends", does: "checks its condition again and again, and never ends while it is true: the command never finishes", example: "$while[1==1]" },
    $onlyforusers: { arg: 1, outcome: "always-stops", does: "matches no one, so it always stops the command", example: "$onlyForUsers[Not for you]" },
    $onlyforroles: { arg: 1, outcome: "always-stops", does: "matches no role, so it always stops the command", example: "$onlyForRoles[Not for you]" },
    $onlyforchannels: { arg: 1, outcome: "always-stops", does: "matches no channel, so it always stops the command", example: "$onlyForChannels[Not here]" },
    $onlyforcategories: { arg: 1, outcome: "always-stops", does: "matches no category, so it always stops the command", example: "$onlyForCategories[Not here]" },
    $onlyforguilds: { arg: 1, outcome: "always-stops", does: "matches no server, so it always stops the command", example: "$onlyForGuilds[Not here]" },
}

/**
 * Functions that pass a `$break`, `$continue` or `$return` in their code on to the function around
 * them, checked on ForgeScript's interpreter: at the top of a command it is then an error. Any other
 * function around one (`$loop`, `$try`, an extension's) may handle it, so nothing is reported there.
 */
const PASSES_ON: Record<string, ReadonlySet<string>> = {
    $break: new Set(["$if", "$elseif", "$else", "$ifx", "$switch", "$case", "$scope", "$arrayforeach"]),
    $continue: new Set(["$if", "$elseif", "$else", "$ifx", "$switch", "$case", "$scope", "$arrayforeach"]),
    $return: new Set(["$if", "$elseif", "$else", "$ifx", "$switch", "$case", "$scope", "$arrayforeach", "$while"]),
}

/**
 * `$callFunction` of a name that is no custom function of the bot, and `$callLocalFunction` of one no
 * earlier `$localFunction` defines, or either with fewer arguments than the function's parameters:
 * ForgeScript stops the command (callFunction.js, callLocalFunction.js, ForgeFunction.call).
 */
function callProblems(calls: readonly Call[], table: FunctionTable, options: CheckOptions, add: Add) {
    const forgescript = (c: Call) => !c.fn.package || c.fn.package === "@tryforge/forgescript"
    const locals = new Map<string, number>()
    const plural = (n: number) => `${n} argument${n > 1 ? "s" : ""}`
    for (const call of [...calls].sort((x, y) => x.start - y.start)) {
        const name = call.fn.name.toLowerCase()
        if (!forgescript(call) || !call.fields?.length) continue
        const target = literal(call.fields[0])
        if (target === null) continue
        const given = call.fields.length - 1
        const stops = (error: string, message: string) => add("invalid-argument", `${message}. ForgeScript stops the command: "${error}"`, call.start, call.end)
        if (name === "$localfunction") {
            if (call.fields.length >= 2) locals.set(target, call.fields.length - 2)
        } else if (name === "$calllocalfunction" && !options.customFunction) {
            // A custom function's body runs in its caller's context, which may have defined it.
            const params = locals.get(target)
            if (params === undefined) stops(`Unknown local function with name ${target}`, `No $localFunction before this one defines "${target}"`)
            else if (given < params) stops(`Calling local function ${target} requires ${plural(params)}, received ${given}`, `"${target}" takes ${plural(params)}, and this call gives ${given}`)
        } else if (name === "$callfunction") {
            const fn = table.get(target)
            if (!fn || (fn.package !== "custom" && fn.package !== "known")) {
                stops(`Unknown function with name ${target}`, `"${target}" is not a custom function of this bot (functions made when it runs go in the config's "known")`)
            } else if (fn.package === "custom") {
                const required = (fn.params ?? []).filter((p) => p.required).length
                if (given < required) stops(`Calling custom function ${fn.name.replace(/^\$/, "")} requires ${plural(required)}, received ${given}`, `"${target}" takes ${plural(required)}, and this call gives ${given}`)
            }
        }
    }
}

/**
 * `$ifx` and `$switch` run only their own branches, found among the functions directly in their block
 * (CompiledFunction.getFunctions): `$ifx` its first `$if`, every `$elseIf` and its first `$else`;
 * `$switch` each `$case`, the first of equal values. Anything else in the block never runs, and those
 * branches outside their block run every time. `$ifx` without an `$if` fails (ifx.js reads it).
 */
function blockProblems(code: string, result: ParseResult, inPrinted: (at: number) => boolean, add: Add) {
    const forgescript = (c: Call) => !c.fn.package || c.fn.package === "@tryforge/forgescript"
    const named = (c: Call, name: string) => forgescript(c) && c.fn.name.toLowerCase() === name
    // Where each call is: the call and field it is directly in.
    const parent = new Map<Call, { call: Call; field: number } | null>()
    const visit = (calls: readonly Call[], where: { call: Call; field: number } | null) => {
        for (const c of calls) {
            parent.set(c, where)
            c.fields?.forEach((f, i) => {
                for (const part of f.kind === "condition" ? [f.lhs, ...(f.rhs ? [f.rhs] : [])] : [f]) visit(part.functions, { call: c, field: i })
            })
        }
    }
    visit(result.functions, null)
    const textOutside = (field: AnyField) => field.kind === "field" && field.value.replace(/\[SYSTEM_FUNCTION\(\d+\)\]/g, "").trim() !== ""
    for (const [call, where] of parent) {
        if (inPrinted(call.start)) continue
        const inBlock = (block: string, field: number) => !!where && named(where.call, block) && where.field === field
        if ((named(call, "$else") || named(call, "$elseif")) && !inBlock("$ifx", 0)) {
            add("misplaced-branch", named(call, "$else") ? `$else is not directly in an $ifx, so it runs its code every time` : `$elseIf is not directly in an $ifx, so it works as a plain $if`, call.start, call.nameEnd)
        }
        if (named(call, "$case") && !inBlock("$switch", 1)) add("misplaced-branch", `$case is not directly in a $switch's cases, so it runs its code every time`, call.start, call.nameEnd)
        if (named(call, "$ifx") && call.fields?.[0]) {
            const block = call.fields[0]
            const direct = block.kind === "field" ? block.functions : []
            if (!direct.some((c) => named(c, "$if"))) {
                add("misplaced-statement", `$ifx has no $if directly in its block. ForgeScript fails with "TypeError: Cannot read properties of undefined (reading 'execute')", which stops the command`, call.start, call.end)
                continue
            }
            const firstIf = direct.find((c) => named(c, "$if"))
            const firstElse = direct.find((c) => named(c, "$else"))
            for (const c of direct) {
                if (c === firstIf || c === firstElse || named(c, "$elseif") || named(c, "$c")) continue
                add("misplaced-branch", `${c.name} never runs: $ifx runs only its first $if, its $elseIf and its first $else`, c.start, c.nameEnd)
            }
            if (textOutside(block)) add("misplaced-branch", `The text in $ifx is never printed: $ifx runs only its $if, $elseIf and $else`, block.start, block.end)
        }
        if (named(call, "$switch") && call.fields?.[1]) {
            const block = call.fields[1]
            const direct = block.kind === "field" ? block.functions : []
            const seen = new Set<string>()
            // $switch compares its value with each $case's exactly (native/statement/switch.js), spaces included.
            const padded = (f: AnyField | undefined) => !!f && f.kind === "field" && /^\s|\s$/.test(f.raw)
            const valuePadded = padded(call.fields[0])
            if (valuePadded && direct.some((c) => named(c, "$case") && !padded(c.fields?.[0]))) {
                add("condition-value", `$switch compares its value with each $case's exactly, and this one has spaces or line breaks around it, so the $case values without them never match. Remove the spaces`, call.fields[0].start, Math.max(call.fields[0].end, call.fields[0].start + 1))
            }
            for (const c of direct) {
                if (named(c, "$case") && !valuePadded && padded(c.fields?.[0])) {
                    const f = c.fields![0]
                    add("condition-value", `This $case's value has spaces or line breaks around it, and $switch compares exactly, so it never matches. Remove the spaces`, f.start, f.end)
                }
                if (named(c, "$c")) continue
                if (!named(c, "$case")) {
                    add("misplaced-branch", `${c.name} never runs: $switch runs only its $case branches`, c.start, c.nameEnd)
                    continue
                }
                const value = c.fields?.[0] ? literal(c.fields[0]) : null
                if (value === null) continue
                if (seen.has(value)) add("misplaced-branch", `This $case never runs: an earlier $case has the same value, ${JSON.stringify(value)}`, c.start, c.nameEnd)
                seen.add(value)
            }
            if (textOutside(block)) add("misplaced-branch", `The text in $switch's cases is never printed: $switch runs only its $case branches`, block.start, block.end)
        }
    }
}

/** Functions that always end the block they run in (native/limiter/stop.js, native/statement/*.js). */
const ENDS_BLOCK = new Set(["$stop", "$break", "$continue", "$return"])

/**
 * Code after a call that always ends its block. ForgeScript runs a block's functions in order and returns
 * at the first that does not succeed (CompiledFunction.resolveCode), so the rest of the block never runs.
 * A function that reads all its arguments before it runs (`unwrap`) ends the block too when one of them
 * does: `$let[x;$stop]`.
 */
function unreachableCode(code: string, result: ParseResult, inPrinted: (at: number) => boolean, add: Add) {
    const forgescript = (c: Call) => !c.fn.package || c.fn.package === "@tryforge/forgescript"
    const parts = (f: AnyField): Field[] => (f.kind === "condition" ? [f.lhs, ...(f.rhs ? [f.rhs] : [])] : [f])
    const ender = (c: Call): Call | null => {
        if (forgescript(c) && ENDS_BLOCK.has(c.fn.name.toLowerCase())) return c
        if (!c.fn.unwrap) return null
        for (const f of c.fields ?? []) for (const part of parts(f)) {
            for (const inner of part.functions) {
                const e = ender(inner)
                if (e) return e
            }
        }
        return null
    }
    const comment = (c: Call) => forgescript(c) && c.fn.name.toLowerCase() === "$c"
    const block = (calls: readonly Call[], start: number, end: number) => {
        const i = calls.findIndex((c) => !inPrinted(c.start) && ender(c))
        if (i >= 0) {
            const after = calls[i]
            const e = ender(after)!
            // What follows, without comments ($c) and blank space.
            let from = -1
            let to = -1
            let at = after.end
            for (const c of [...calls.slice(i + 1), null]) {
                const stop = c ? c.start : end
                const text = code.slice(at, stop)
                const lead = text.search(/\S/)
                if (lead >= 0) {
                    if (from < 0) from = at + lead
                    to = at + text.trimEnd().length
                }
                if (!c) break
                if (!comment(c)) {
                    if (from < 0) from = c.start
                    to = c.end
                }
                at = c.end
            }
            if (from >= 0) {
                const via = e === after ? e.name : `${e.name} (in ${after.name})`
                add("unreachable-code", `This never runs: ${via} ends the block before it`, from, to)
            }
        }
        for (const c of calls) {
            if (comment(c) || inPrinted(c.start)) continue
            for (const f of c.fields ?? []) for (const part of parts(f)) block(part.functions, part.start, part.end)
        }
    }
    block(result.functions, 0, code.length)
}

/** `$break`, `$continue` and `$return` whose every enclosing function passes them on to the top of a command. */
function misplacedStatements(result: ParseResult, options: CheckOptions, inPrinted: (at: number) => boolean, add: Add) {
    const forgescript = (c: Call) => !c.fn.package || c.fn.package === "@tryforge/forgescript"
    const visit = (calls: readonly Call[], path: Call[]) => {
        for (const call of calls) {
            const name = call.fn.name.toLowerCase()
            const passes = PASSES_ON[name]
            // A custom function's body may $return, and runs where its caller is: not judged here.
            if (passes && forgescript(call) && !options.customFunction && !inPrinted(call.start) && path.every((p) => forgescript(p) && passes.has(p.fn.name.toLowerCase()))) {
                const kind = name === "$return" ? "Return" : name === "$break" ? "Break" : "Continue"
                const sent = `":x: ${kind} statements are not allowed in outer scopes."`
                if (name === "$return") add("misplaced-statement", `$return only returns from a custom function, $loop, $try or an array function's code: here, when it runs, ForgeScript stops the command and sends ${sent}. To end the command, use $stop`, call.start, call.end)
                else add("misplaced-statement", `${call.name} is not inside $loop or $while: when it runs, ForgeScript stops the command and sends ${sent}`, call.start, call.end)
            }
            for (const field of call.fields ?? []) {
                for (const part of field.kind === "condition" ? [field.lhs, ...(field.rhs ? [field.rhs] : [])] : [field]) visit(part.functions, [...path, call])
            }
        }
    }
    visit(result.functions, [])
}

/**
 * Functions whose own work fails on some argument values, which their argument types let through: the
 * same operation as their `execute`, run on the values as ForgeScript resolves them. It throws what
 * ForgeScript would, and that error is what it logs. Each is run on ForgeScript's interpreter by
 * test/runtime.test.js. `later`: the value is stored, and a later function fails on it.
 */
export const ExecuteChecks: Record<string, { args: number[]; run: (values: unknown[]) => unknown; later?: string }> = {
    // new Array(n || 0): a negative, fractional or too large length.
    $arraycreate: { args: [1], run: ([n]) => new Array((n as number) || 0) },
    // parseInt(n, from ?? 10).toString(to): a base outside 2 to 36.
    $base: { args: [1], run: ([to]) => (10).toString(to as number) },
    $decodeuri: { args: [0], run: ([text]) => decodeURI(text as string) },
    $decodeuricomponent: { args: [0], run: ([text]) => decodeURIComponent(text as string) },
    // text.repeat(times): only a negative or infinite count throws (checked without building the text).
    $repeat: { args: [1], run: ([n]) => ((n as number) < 0 || n === Infinity ? "x".repeat(n as number) : "") },
    // new RegExp(match, flags)
    $replaceregex: { args: [1, 2], run: ([match, flags]) => new RegExp(match as string, (flags as string | null) ?? undefined) },
    // Stored in ctx.timezone; the time functions after it pass it to toLocaleString.
    $settimezone: { args: [0], later: "the next function that uses the time zone", run: ([zone]) => new Intl.DateTimeFormat("en-US", { timeZone: zone as string }) },
}

/** Functions that print their argument's code as written instead of running it (`rawValue` in ForgeScript). */
const AS_WRITTEN = new Set(["$escapecode"])
/** What still matters in code that is printed, not run: whether it compiles, and where its brackets close. */
const STILL_APPLIES = new Set<Rule>(["missing-brackets", "too-many-arguments", "unclosed-bracket", "unescaped-bracket", "stray-bracket"])

/** The parts of the code that ForgeScript prints as written and never runs: the inside of `$escapeCode[...]`. */
export function printedAsWritten(result: ParseResult): Array<{ start: number; end: number; call: Call }> {
    const out: Array<{ start: number; end: number; call: Call }> = []
    for (const call of walk(result.functions)) {
        if (AS_WRITTEN.has(call.fn.name.toLowerCase()) && call.open !== null) out.push({ start: call.open + 1, end: call.close ?? call.end, call })
    }
    return out
}
/** The argument of an environment writer that names the variable. */
const ENV_NAME_ARG = /^(variable|var|name|output variable|variable name)$/i

/** Every problem in one string of code. */
export function checkCode(code: string, table: FunctionTable, options: CheckOptions = {}, result: ParseResult = parse(code, table, { recover: true })): Finding[] {
    const out: Finding[] = []
    const add = (rule: Rule, message: string, start: number, end: number) => out.push({ rule, severity: Rules[rule].severity, message, start, end: Math.max(end, start) })
    // Code inside $escapeCode is printed, not run: only the problems that still apply to it are kept.
    const printed = printedAsWritten(result)
    const inPrinted = (at: number) => printed.some((p) => p.start <= at && at < p.end)
    const calls = Array.from(walk(result.functions)).filter((c) => !inPrinted(c.start))
    const issues = nameIssues(code, table, result)

    for (const e of result.errors) {
        const fn = table.get(e.fn)
        const help = fn && fn.params ? `Usage: ${usage(fn)}` : ""
        // `$authorI`: no such function, so ForgeScript reads `$author`, which needs brackets. One error, not
        // an error and a glued-name warning, and the name that was probably meant.
        const glued = e.kind === "requires-brackets" ? issues.find((x) => x.kind === "glued" && x.start === e.start) : undefined
        if (glued && fn) {
            issues.splice(issues.indexOf(glued), 1)
            const guess = suggest(glued.written, table, fn)
            const parts = [`${glued.written} is not a function here: ForgeScript reads ${glued.runs}, which requires brackets, so the code does not compile.`, guess ? `Did you mean ${guess}?` : "", help]
            add(COMPILE_RULE[e.kind], parts.filter(Boolean).join(" "), glued.start, glued.end)
            continue
        }
        add(COMPILE_RULE[e.kind], help ? `${e.message}. ${help}` : e.message, e.start, e.end)
    }

    // Where a misspelt or unknown name sits: the argument it is in is not checked as a value too.
    const misnamed = (field: AnyField) => issues.some((x) => field.start <= x.start && x.start < field.end)
    const incomplete = new Set<Call>()
    for (const call of calls) {
        const fn = call.fn
        // A call with a compile error inside never runs, and its arguments are only a guess after the error.
        const compiles = !result.errors.some((e) => call.start <= e.start && e.start < call.end)
        if (fn.args === null && code[call.nameEnd] === "[") {
            add("unexpected-brackets", `${call.name} takes no arguments, so "[" and what follows it are printed as text`, call.nameEnd, call.nameEnd + 1)
        }
        if (fn.deprecated) add("deprecated", `${call.name} is deprecated${fn.package ? ` in ${fn.package}` : ""}`, call.start, call.nameEnd)
        const declared = declaredSpelling(call)
        if (declared) add("function-case", `Declared as $${declared}; $${call.written.slice(1)} works too, since names ignore case`, call.nameStart, call.nameEnd)

        // Only where ForgeScript resolves the arguments itself: functions like $if read their own fields.
        const listed = !fn.unwrap && (!fn.package || fn.package === "@tryforge/forgescript") ? UncheckedArguments[fn.name.toLowerCase()] : undefined
        // A function's own check, read from its source, says the same as a "stops" entry: it is reported below.
        const unchecked = listed && !(listed.outcome === "stops" && fn.resolved?.includes(listed.arg)) ? listed : undefined
        if (unchecked && call.fields && call.fields.length <= unchecked.arg && compiles) {
            const arg = fn.params?.[unchecked.arg]?.name ?? `argument ${unchecked.arg + 1}`
            const end = call.close !== null ? call.close + 1 : call.end
            const help = fn.params ? ` Usage: ${usage(fn)}` : ""
            if (unchecked.outcome === "stops") add("too-few-arguments", `${call.name} is missing its argument "${arg}", so ForgeScript stops the command: "Function ${call.name} is missing argument ${arg}".${help}`, call.start, end)
            else if (unchecked.outcome === "crashes") add("too-few-arguments", `${call.name} is missing its argument "${arg}". ForgeScript does not check for it, and fails with "TypeError: Cannot read properties of undefined (reading '${unchecked.reads}')", which stops the command.${help}`, call.start, end)
            else {
                add("incomplete-call", `${call.name} has no "${arg}", which ForgeScript does not check: it ${unchecked.does}.${help}`, call.start, end)
                incomplete.add(call)
            }
        }
        const work = compiles && fn.unwrap && options.values && (!fn.package || fn.package === "@tryforge/forgescript") ? ExecuteChecks[fn.name.toLowerCase()] : undefined
        const reportedBefore = out.length
        // The arguments ForgeScript checks, in the order it does: all of them for an unwrap function
        // (CompiledFunction.resolveArgs), the ones read from the source for a function that reads its own.
        const order = !call.fields || !fn.params || !compiles ? null : fn.unwrap ? [...call.fields.keys(), ...fn.params.keys()].filter((i, k, all) => all.indexOf(i) === k) : fn.resolved ?? null
        // A function the compiler takes as having no brackets (args null) whose argument is required
        // ($entitlementConsume in ForgeScript 2.8): it is always resolved without it, and stops.
        if (!call.fields && compiles && fn.unwrap && fn.args === null) {
            const missing = fn.params?.find((p) => p.required)
            if (missing) add("too-few-arguments", `${call.name} is missing its argument "${missing.name}", so ForgeScript stops the command: "Function ${call.name} is missing argument ${missing.name}". It takes no brackets, so the argument cannot be given`, call.start, call.end)
        }
        if (order && call.fields && fn.params) {
            // The first refusal stops the command, so nothing after it is reported.
            for (const i of order) {
                const field = call.fields[i]
                const param = paramAt(fn.params, i)
                if (!param) continue
                if (!field) {
                    if (!param.required || (param.rest && i > 0 && i >= fn.params.length)) continue
                    add("too-few-arguments", `${call.name} is missing its argument "${param.name}", so ForgeScript stops the command: "Function ${call.name} is missing argument ${param.name}". Usage: ${usage(fn)}`, call.start, call.close !== null ? call.close + 1 : call.end)
                    break
                }
                const text = literal(field)
                if (!options.values || text === null || misnamed(field)) continue
                const problem = options.values.check(param, text, call.name)
                if (!problem) continue
                out.push({ rule: problem.rule, severity: problem.severity, message: problem.message, start: field.start, end: field.end })
                if (problem.severity === "error") break
            }
        }
        // Every argument passed: the function's own work, on the values as ForgeScript resolves them.
        if (work && call.fields && fn.params && !out.slice(reportedBefore).some((f) => f.severity === "error")) {
            const resolved = work.args.map((i) => {
                const field = call.fields![i]
                const param = fn.params![i]
                const text = field ? literal(field) : ""
                if (text === null || (field && misnamed(field))) return undefined
                if (!param?.required && text === "") return null
                return param?.type === "Number" ? Number(text) : text
            })
            if (!resolved.includes(undefined)) {
                let thrown: Error | null = null
                try {
                    work.run(resolved)
                } catch (e) {
                    thrown = e as Error
                }
                if (thrown) {
                    const i = work.args.find((k) => call.fields![k]) ?? work.args[0]
                    const at = call.fields[i] ?? call.fields[call.fields.length - 1]
                    const values = work.args.filter((k) => call.fields![k]).map((k) => `${fn.params![k]?.name} ${JSON.stringify(literal(call.fields![k]!) ?? "")}`).join(" and ")
                    const error = `${thrown.name}: ${thrown.message}`
                    if (work.later) add("invalid-argument", `${call.name} stores ${values}, which ForgeScript cannot use: the command stops at ${work.later}, with "${error}"`, at.start, at.end)
                    else add("invalid-argument", `${call.name} cannot use ${values}. ForgeScript stops the command: "${error}"`, at.start, at.end)
                }
            }
        }
        for (const field of call.fields ?? []) {
            if (field.kind === "condition") conditionProblems(code, call, field, add, incomplete.has(call), options.values)
            for (const part of field.kind === "condition" ? [field.lhs, ...(field.rhs ? [field.rhs] : [])] : [field]) textProblems(code, call, part, add)
        }
    }
    for (const at of strayBrackets(code, result)) {
        add("stray-bracket", "This ] closes no function, so ForgeScript prints it. If it is meant as text, escape it as \\] (\\\\] in a JavaScript string)", at, at + 1)
    }
    for (const b of unescapedBrackets(code, result)) {
        add("unescaped-bracket", `This ] closes ${b.call.name}, not the [ in its text, so what follows is printed. Escape both as \\[ and \\] (\\\\[ and \\\\] in a JavaScript string)`, b.close, b.close + 1)
    }

    for (const issue of issues) {
        const guess = suggest(issue.written, table)
        if (issue.kind === "unknown") {
            add("unknown-function", `${issue.written} is not a function here, so ForgeScript prints it as text${guess ? `. Did you mean ${guess}?` : ""}`, issue.start, issue.end)
        } else {
            const other = guess && guess.toLowerCase() !== issue.runs!.toLowerCase() ? ` Did you mean ${guess}?` : ""
            add("glued-name", `${issue.written} runs ${issue.runs} and prints "${issue.rest}" after it${other ? `.${other}` : ""}`, issue.start, issue.end)
        }
    }

    misplacedOperators(code, calls, add)
    if (!result.errors.length) callProblems(calls, table, options, add)
    if (!result.errors.length) blockProblems(code, result, inPrinted, add)
    if (options.event && !options.customFunction) {
        const event = options.event
        const article = /^[aeiou]/i.test(event.name) ? "an" : "a"
        for (const call of calls) {
            const need = call.fn.context
            if (!need) continue
            if (need.event && call.fn.package) {
                if (event.packages.includes(call.fn.package)) continue
                const outcome = need.crash ? `ForgeScript stops the command ("${need.crash}")` : "it has no event data to read here"
                add("missing-context", `${call.name} reads data that only the events of ${call.fn.package} give, and ${article} ${event.name} command is not one of them: ${outcome}`, call.start, call.nameEnd)
                continue
            }
            if (call.fn.package && call.fn.package !== "@tryforge/forgescript") continue
            if (need.interaction && !event.interaction) add("missing-context", `${call.name} reads the interaction, and ${article} ${event.name} command has none: it does nothing and gives ${/^\$is/i.test(call.fn.name) ? "false" : "nothing"} here`, call.start, call.nameEnd)
            else if (need.state && event.states && !event.states.has(need.state)) add("missing-context", `${call.name} reads the event's ${need.state} state, which ${event.name} does not give: it always gives nothing here`, call.start, call.nameEnd)
            else if (need.words && !event.words) add("missing-context", `${call.name} reads the words of a message command, and ${article} ${event.name} command has none: it always gives nothing here`, call.start, call.nameEnd)
        }
    }
    if (!result.errors.length) misplacedStatements(result, options, inPrinted, add)
    if (!result.errors.length) unreachableCode(code, result, inPrinted, add)
    // Code that does not compile never runs: what its variables would do does not matter.
    if (!result.errors.length) variableProblems(calls, options, add)
    return out.filter((f) => STILL_APPLIES.has(f.rule) || !inPrinted(f.start)).sort((a, b) => a.start - b.start || a.end - b.end)
}

type Add = (rule: Rule, message: string, start: number, end: number) => void

/** The first required argument the call does not have, or `null`. */
function missingArgument(fn: IRawFunction, fields: readonly AnyField[]): string | null {
    const params = fn.params ?? []
    for (let i = 0; i < params.length; i++) if (params[i].required && i >= fields.length) return params[i].name
    return null
}

function paramAt(params: readonly IParam[], i: number): IParam | undefined {
    if (i < params.length) return params[i]
    const last = params[params.length - 1]
    return last?.rest ? last : undefined
}

/** The argument's text when it is plain text (no calls, nothing filled in when the bot runs). */
function literal(field: AnyField): string | null {
    if (field.kind !== "field" || field.functions.length || field.value.includes("\u0000")) return null
    return field.value
}

/** The spelling the function or alias is declared with, when the written one differs only in case. */
export function declaredSpelling(call: Call): string | null {
    const written = call.written.slice(1)
    for (const name of [call.fn.name, ...(call.fn.aliases ?? [])]) {
        const bare = name.replace(/^\$/, "")
        if (bare.toLowerCase() === written.toLowerCase()) return bare === written ? null : bare
    }
    return null
}

/** The characters of a field outside its calls, with whether each was escaped with `\`. */
function textOf(code: string, field: Field): Array<{ at: number; ch: string; escaped: boolean }> {
    const out: Array<{ at: number; ch: string; escaped: boolean }> = []
    let k = 0
    for (let i = field.start; i < field.end && i < code.length; ) {
        const inner = field.functions[k]
        if (inner && i === inner.start) {
            i = inner.end
            k++
            continue
        }
        if (code[i] === "\\" && i + 1 < code.length) {
            out.push({ at: i, ch: code[i + 1], escaped: true })
            i += 2
            continue
        }
        out.push({ at: i, ch: code[i], escaped: false })
        i++
    }
    return out
}

/** The `[`s in a field's text that no escaped `]` closes. */
function openBrackets(code: string, field: Field): number[] {
    const open: number[] = []
    for (const { at, ch, escaped } of textOf(code, field)) {
        if (!escaped && ch === "[") open.push(at)
        else if (escaped && ch === "]" && open.length) open.pop()
    }
    return open
}

/** A `]` that closes its function while a `[` in the argument's text is still open: the `[`s and the `]`. */
export interface UnescapedBracket {
    call: Call
    opens: number[]
    close: number
}

/**
 * Every argument whose `]` closes its function while a `[` in its text is open. Calls that contain a
 * compile error are left out: ForgeScript compiles none of the code, and where their brackets belong
 * is only the parser's guess after the error.
 */
export function unescapedBrackets(code: string, result: ParseResult): UnescapedBracket[] {
    const out: UnescapedBracket[] = []
    for (const call of walk(result.functions)) {
        if (result.errors.some((e) => call.start <= e.start && e.start < call.end)) continue
        for (const field of call.fields ?? []) {
            for (const part of field.kind === "condition" ? [field.lhs, ...(field.rhs ? [field.rhs] : [])] : [field]) {
                const opens = openBrackets(code, part)
                if (opens.length && code[part.end] === "]") out.push({ call, opens, close: part.end })
            }
        }
    }
    return out
}

/**
 * Every `]` in the code's own text (outside all functions) that no `[` before it in that text opened.
 * ForgeScript prints it; `Page [1/3]` is left alone. Not for code that does not compile, where what is
 * outside the functions is only the parser's guess after the error. A `[` in an argument's text that
 * closes a function early pushes that function's own `]` out, one level per `[`, to the code's text:
 * those are part of that mistake (`unescaped-bracket`) and go with its fix, so they are not counted.
 */
export function strayBrackets(code: string, result: ParseResult): number[] {
    if (result.errors.length) return []
    const early = unescapedBrackets(code, result)
    const out: number[] = []
    let open = 0
    let k = 0
    for (let i = 0; i < code.length; ) {
        const call = result.functions[k]
        if (call && i === call.start) {
            for (const e of early) if (call.start <= e.call.start && e.call.start < call.end) open += e.opens.length
            i = call.end
            k++
            continue
        }
        const c = code[i]
        if (c === "\\") i += 2
        else {
            if (c === "[") open++
            else if (c === "]") open ? open-- : out.push(i)
            i++
        }
    }
    return out
}

function textProblems(code: string, call: Call, field: Field, add: Add) {
    for (const { at, ch, escaped } of textOf(code, field)) {
        if (escaped && /[A-Za-z0-9]/.test(ch)) {
            add("escaped-letter", `\\${ch} inside ${call.name}'s argument is just "${ch}": ForgeScript drops the backslash${ch === "n" ? ". For a new line, use a real line break" : ""}`, at, at + 2)
        }
    }
}

function conditionProblems(code: string, call: Call, field: Extract<AnyField, { kind: "condition" }>, add: Add, incomplete = false, values?: ValueChecker) {
    const plain = (f: Field) => textOf(code, f).filter((c) => !c.escaped).map((c) => c.ch).join("")
    if (field.op !== "unknown" && field.rhs) {
        const rhs = plain(field.rhs)
        const second = Operators.find((op) => rhs.includes(op))
        if (second) add("condition-operator", `Only the first operator counts in ${call.name}: the right side of ${field.op} is the text ${JSON.stringify(field.rhs.raw)}. To combine conditions, use $and[...;...] or $or[...;...]`, field.start, field.end)
        else if (!incomplete) conditionValues(code, call, field, add, values)
        return
    }
    const text = plain(field.lhs)
    if (!field.lhs.functions.length && text.trim() === "") {
        // In a call that has nothing to run (incomplete-call), what its condition is changes nothing.
        if (!incomplete) add("condition-operator", `This condition of ${call.name} is empty, which ForgeScript reads as false`, field.start, Math.max(field.end, field.start + 1))
    } else if (text.includes("&&") || text.includes("||")) {
        add("condition-operator", `&& and || are not operators in ForgeScript, so ${call.name} compares nothing here. Use $and[...;...] or $or[...;...]`, field.start, field.end)
    } else if (!field.lhs.functions.length && !["", "true", "false"].includes(text.trim())) {
        add("condition-operator", `${JSON.stringify(text)} has no operator, so ${call.name} only treats it as true when it is exactly "true"`, field.start, field.end)
    } else if (!incomplete) conditionValues(code, call, field, add, values)
}

/** What one side of a condition is: its text, and the call it is when it is a single call. */
function sideOf(code: string, side: Field) {
    const rest = textOf(code, side).map((c) => c.ch).join("")
    const only = side.functions.length === 1 && rest.trim() === "" ? side.functions[0] : null
    return {
        side,
        literal: side.functions.length === 0,
        text: rest,
        /** A single call to a function that gives only true or false. */
        boolean: !!only && !only.negated && only.fn.output?.length === 1 && only.fn.output[0] === "Boolean" ? only : null,
        /** A single call to a function that gives only numbers. */
        number: !!only && !only.negated && only.fn.output?.length === 1 && only.fn.output[0] === "Number" ? only : null,
        /** Spaces or line breaks at its start or end (in its text, not in a call's output). */
        padded: /^\s|\s$/.test(side.raw),
    }
}

/**
 * Conditions false whatever the values, read from ForgeScript's `Conditions` (core/Compiler.js): `==`
 * and `!=` compare the text exactly, spaces included; `<`, `<=`, `>`, `>=` compare `Number(...)`, NaN for
 * a word; with no operator, only the exact text `true` is true.
 */
function conditionValues(code: string, call: Call, field: Extract<AnyField, { kind: "condition" }>, add: Add, values?: ValueChecker) {
    let reported = false
    valueProblems(code, call, field, (...a) => ((reported = true), add(...a)))
    if (reported || !values) return
    const lhs = sideOf(code, field.lhs)
    const rhs = field.rhs ? sideOf(code, field.rhs) : null
    if (!lhs.literal || (rhs && !rhs.literal)) return
    // $while[true;...] is how a loop that ends with $break is written.
    if (!rhs && lhs.text === "true" && /^\$while$/i.test(call.fn.name)) return
    const result = values.condition(field.op, lhs.text, rhs ? rhs.text : null)
    if (result === null) return
    const shown = rhs ? `${JSON.stringify(lhs.text)} ${field.op} ${JSON.stringify(rhs.text)}` : JSON.stringify(lhs.text)
    add("constant-condition", `This condition is always ${result}: it is fixed text (${shown}), so ${call.name} gives the same result every time`, field.start, Math.max(field.end, field.start + 1))
}

function valueProblems(code: string, call: Call, field: Extract<AnyField, { kind: "condition" }>, add: Add) {
    const lhs = sideOf(code, field.lhs)
    if (field.op === "unknown") {
        if (lhs.padded && (lhs.boolean || (lhs.literal && lhs.text.trim() === "true"))) {
            add("condition-value", `${call.name} treats this as true only when it is exactly "true", and the spaces or line breaks around it are part of it, so it is always false. Remove them`, field.start, field.end)
        } else if (lhs.number) {
            add("condition-value", `${lhs.number.name} gives a number, and with no operator ${call.name} is true only for the text "true", so it is always false. Compare it, as in ${lhs.number.name}>0`, field.start, field.end)
        }
        return
    }
    if (!field.rhs) return
    const rhs = sideOf(code, field.rhs)
    const sides = [lhs, rhs]
    if (field.op === "==" || field.op === "!=") {
        const always = field.op === "==" ? "false" : "true"
        const padded = sides.filter((s) => s.padded)
        if (padded.length && !(lhs.literal && rhs.literal && lhs.side.raw === rhs.side.raw)) {
            const where = padded.length === 2 ? "on both sides" : padded[0] === lhs ? "on the left side" : "on the right side"
            add("condition-value", `${field.op} compares each side's text exactly, spaces and line breaks included, so ${call.name} is ${always} unless the values have the same spaces. Remove the spaces ${where}`, field.start, field.end)
            return
        }
        for (const [a, b] of [[lhs, rhs], [rhs, lhs]] as const) {
            if (a.boolean && b.literal && !["", "true", "false"].includes(b.text)) {
                const hint = ["true", "false"].includes(b.text.toLowerCase()) ? `. Write ${b.text.toLowerCase()}` : ""
                add("condition-value", `${a.boolean.name} gives true or false, never ${JSON.stringify(b.text)}, so this ${field.op} is always ${always}${hint}`, field.start, field.end)
                return
            }
        }
        return
    }
    for (const s of sides) {
        if (s.literal && Number.isNaN(Number(s.text))) {
            add("condition-value", `${field.op} compares numbers, and ${JSON.stringify(s.text)} is not one (ForgeScript reads it as NaN), so ${call.name} is always false`, field.start, field.end)
            return
        }
        if (s.boolean) {
            add("condition-value", `${field.op} compares numbers, and ${s.boolean.name} gives true or false (NaN as a number), so ${call.name} is always false`, field.start, field.end)
            return
        }
    }
}

/** `$` with `!`, `#` or `@[...]` in another order than `$!#@[...]name`, or followed by another `$`. */
function misplacedOperators(code: string, calls: Call[], add: Add) {
    const starts = new Set(calls.map((c) => c.start))
    for (const m of code.matchAll(/\$((?:[!#]|@\[[^\]\n\r]*\])+)(\$?)/g)) {
        const at = m.index!
        if (starts.has(at) || code[at - 1] === "\\") continue
        const valid = /^!?#?(@\[[^\]\n\r]*\])?$/.test(m[1])
        if (m[2]) add("misplaced-operator", `"$${m[1]}" is followed by another $, so it applies to nothing and is printed. Write $${m[1]}name[...] with no $ in between`, at, at + m[0].length)
        else if (!valid) add("misplaced-operator", `"$${m[1]}" is not in ForgeScript's order ($ then !, then #, then @[...]), so the call is printed as text`, at, at + m[0].length)
    }
}

function variableProblems(calls: Call[], options: CheckOptions, add: Add) {
    // Only when every function's use of the variables is known (read from its source): a custom
    // function or an extension known only from metadata can read or set variables where they cannot
    // be seen, and $eval and the like run code nobody sees here.
    if (!calls.length || calls.some((c) => !c.fn.stores || c.fn.package === "custom" || OPAQUE.has(c.name.toLowerCase()))) return
    const first = (c: Call) => (c.fields?.[0] ? literal(c.fields[0]) : null)
    const set = new Map<string, Call>()
    const read = new Set<string>()
    const env = new Set<string>()
    for (const c of calls) {
        const s = c.fn.stores!
        if (s.setsVariable || s.readsVariable) {
            const name = first(c)
            if (name === null) return // a computed name could be any variable
            if (s.setsVariable && !set.has(name)) set.set(name, c)
            if (s.readsVariable) read.add(name)
        }
        if (s.setsEnvironment) {
            c.fn.params?.forEach((p, i) => {
                const v = ENV_NAME_ARG.test(p.name) && c.fields?.[i] ? literal(c.fields[i]) : null
                if (v) env.add(v)
            })
        }
    }
    for (const [name, c] of set) {
        if (read.has(name) || c.name.toLowerCase() !== "$let" || name === "") continue
        const value = c.fields?.[1]
        const only = value?.kind === "field" && value.functions.length === 1 && value.value.trim() === `[SYSTEM_FUNCTION(${value.functions[0].index})]` ? value.functions[0] : null
        if (only) add("hidden-output", `$let[${name};...] is never read, so it only hides the output of ${only.name}: $!${only.written.slice(1)} does that without a variable`, c.start, c.end)
        else add("unused-variable", `$let[${name};...] is never read: nothing here uses $get[${name}]`, c.start, c.end)
    }
    for (const c of calls) {
        const name = first(c)
        if (!name) continue
        const n = c.name.toLowerCase()
        if (n === "$get" && !set.has(name)) {
            if (env.has(name)) add("wrong-store", `${name} is set by an environment function here, which $env reads: $get[${name}] is always empty. Use $env[${name}]`, c.start, c.end)
            else if (!options.customFunction) add("unset-variable", `$get[${name}] reads a variable nothing here sets with $let, so it is always empty`, c.start, c.end)
        }
        if (n === "$env" && set.has(name) && !env.has(name) && !options.customFunction) {
            add("wrong-store", `${name} is set with $let, which $get reads: $env[${name}] is always empty. Use $get[${name}]`, c.start, c.end)
        }
    }
}

/** Suggestions already worked out, per table: a bot repeats its typos. */
const suggested = new WeakMap<FunctionTable, Map<string, string | null>>()

/** The closest function name to a mistyped one, or `null` when none is close enough. `except` is never suggested. */
export function suggest(written: string, table: FunctionTable, except?: IRawFunction): string | null {
    const key = `${written.toLowerCase()}\u0000${except?.name ?? ""}`
    let cache = suggested.get(table)
    if (!cache) suggested.set(table, (cache = new Map()))
    if (cache.has(key)) return cache.get(key)!
    const found = closestName(written, table, except)
    cache.set(key, found)
    return found
}

function closestName(written: string, table: FunctionTable, except?: IRawFunction): string | null {
    const word = written.replace(/^\$/, "").toLowerCase()
    const limit = word.length <= 4 ? 1 : word.length <= 8 ? 2 : 3
    let best: string | null = null
    let bestDistance = Infinity
    for (const [key, fn] of table.byKey) {
        const name = key.slice(1)
        if (fn === except || Math.abs(name.length - word.length) > limit) continue
        const d = distance(word, name, limit)
        if (d < bestDistance || (d === bestDistance && best !== null && fn.name.length < best.length)) {
            bestDistance = d
            best = key === fn.name.toLowerCase() ? fn.name : `$${matchCase(key.slice(1), fn)}`
        }
    }
    return bestDistance <= limit && bestDistance > 0 ? best : null
}

/** An alias in the case its function declares it. */
function matchCase(alias: string, fn: IRawFunction) {
    return (fn.aliases ?? []).find((a) => a.replace(/^\$/, "").toLowerCase() === alias)?.replace(/^\$/, "") ?? alias
}

/** Edit distance with transpositions, giving up above `limit`. */
export function distance(a: string, b: string, limit = Infinity): number {
    if (a === b) return 0
    let prev2: number[] = []
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
    for (let i = 1; i <= a.length; i++) {
        const cur = [i]
        let rowMin = i
        for (let j = 1; j <= b.length; j++) {
            let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1)
            cur.push(v)
            rowMin = Math.min(rowMin, v)
        }
        if (rowMin > limit) return Infinity
        prev2 = prev
        prev = cur
    }
    return prev[b.length]
}
