"use strict"
// Runs ForgeScript code as a command does (no top-level $return) and prints, as one line of JSON, its
// output and the error ForgeScript logs: `node test/support/run-code.js '<code>'`. Never logs in.
const forgescript = require("@tryforge/forgescript")
const { ForgeClient, Compiler, Interpreter } = forgescript
const log = []
const write = process.stdout.write.bind(process.stdout)
process.stdout.write = process.stderr.write = (chunk) => (log.push(String(chunk)), true)
const client = new ForgeClient({ intents: ["Guilds"] })
const code = process.argv[2]
const done = (result) => {
    write(JSON.stringify(result))
    process.exit(0)
}
let data
try {
    data = Compiler.compile(code)
} catch (e) {
    done({ compileError: e.message })
}
Interpreter.run({ client, data, obj: { channel: { id: "1" } }, command: null, doNotSend: true, redirectErrorsToConsole: true })
    .then((output) => done({ output, error: /\[ERROR\][^\n]*/.exec(log.join("").replace(/\x1b\[[0-9;]*m/g, ""))?.[0].replace(/[*`]/g, "") ?? null }))
    .catch((e) => done({ threw: e.message }))
