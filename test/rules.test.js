"use strict"
// Each rule, on code that has the problem and on code that does not, with ForgeScript's own
// resolvers deciding the argument values (as in a bot).
const { test } = require("node:test")
const assert = require("node:assert/strict")
const forgescript = require("@tryforge/forgescript")
const discord = require("discord.js")
const { FunctionTable, checkCode, ValueChecker, Rules } = require("..")

forgescript.FunctionManager.loadNative()
const table = FunctionTable.fromForgeScript(forgescript)
const values = new ValueChecker(forgescript, discord)
const rules = (code, options = {}) => checkCode(code, table, { values, ...options }).map((f) => f.rule)
const messages = (code, rule) => checkCode(code, table, { values }).filter((f) => f.rule === rule).map((f) => f.message)

const CASES = {
    "invalid-argument": {
        bad: ["$round[abc]", "$addButton[id;label;primary]", "$ephemeral$addButton[id;label;Primary;;yes]", "$wait[1.5h]", "$sendMessage[;hi]", "$hasPerms[$guildID;$authorID;manageMessages]"],
        good: ["$round[1.5]", "$addButton[id;label;Primary]", "$addButton[id;label;Primary;;true]", "$wait[1h30m]", "$sendMessage[$channelID;hi]", "$hasPerms[$guildID;$authorID;ManageMessages]", "$round[$get[x]]", "$addButton[id;label;0]"],
    },
    "color-value": { bad: ["$color[blue]", "$color[red]", "$color[123456]"], good: ["$color[Blue]", "$color[#ff0000]", "$color[ff0000]", "$color[Random]", "$color[0]", "$color[$get[c]]"] },
    "http-url": { bad: ["$createGuild[Test;http://example.com/a.png]"], good: ["$createGuild[Test;https://example.com/a.png]", "$image[http://example.com/a.png]"] },
    "condition-operator": {
        bad: ["$if[$get[a]==1==2;x;y]", "$if[$get[a]==1&&$get[b]==2;x;y]", "$if[yes;x;y]"],
        good: ["$if[$get[a]==1;x;y]", "$if[true;x;y]", "$if[$get[flag];x;y]", "$if[$get[a]==\\=\\=;x;y]"],
    },
    "unescaped-bracket": { bad: ["$description[[Docs](https://x.y)]"], good: ["$description[\\[Docs\\](https://x.y)]", "$description[a]"] },
    "escaped-letter": { bad: ["$description[line\\nnext]"], good: ["$description[line\nnext]", "$description[a\\;b]"] },
    "misplaced-operator": { bad: ["$#!ping", "$!$ping"], good: ["$!#ping", "$!ping", "$#ping", "$@[,]ping"] },
    "unused-variable": { bad: ["$let[a;1]done"], good: ["$let[a;1]$get[a]", "$let[a;1]$letSum[a;1]"] },
    "hidden-output": { bad: ["$let[x;$ping]"], good: ["$!ping", "$let[x;$ping]$get[x]"] },
    "unset-variable": { bad: ["$get[a]"], good: ["$let[a;1]$get[a]"] },
    "wrong-store": { bad: ["$arrayCreate[list;3]$get[list]", "$let[a;1]$env[a]"], good: ["$arrayCreate[list;3]$env[list]", "$let[a;1]$get[a]"] },
    "function-case": { bad: ["$AUTHORID", "$authorid"], good: ["$authorID"] },
    "too-few-arguments": { bad: ["$addField[Coins]"], good: ["$addField[Coins;5]", "$if[1==1]"] },
    "unexpected-brackets": { bad: ["$ping[x]"], good: ["$ping"] },
}

for (const [rule, { bad, good }] of Object.entries(CASES)) {
    test(`${rule}: found where it applies, not elsewhere`, () => {
        for (const code of bad) assert.ok(rules(code).includes(rule), `${rule} expected in ${JSON.stringify(code)}, got ${JSON.stringify(rules(code))}`)
        for (const code of good) assert.ok(!rules(code).includes(rule), `${rule} not expected in ${JSON.stringify(code)}`)
    })
}

test("every rule has a test case or a test elsewhere", () => {
    const elsewhere = ["missing-brackets", "too-many-arguments", "unclosed-bracket", "unknown-function", "glued-name", "deprecated"]
    for (const rule of Object.keys(Rules)) assert.ok(rule in CASES || elsewhere.includes(rule), `no test for ${rule}`)
})

test("the messages say what ForgeScript does", () => {
    assert.match(messages("$color[blue]", "color-value")[0], /hexadecimal up to its first non-hex letter: #00000b\. Write Blue/)
    assert.match(messages("$color[123456]", "color-value")[0], /decimal number 123456 \(#01e240\), not as #123456/)
    assert.match(messages("$addButton[id;label;primary]", "invalid-argument")[0], /"style" must be Primary \(letter case matters\), not "primary"/)
    assert.match(messages("$round[abc]", "invalid-argument")[0], /^\$round: "number" must be a number, not "abc"\. ForgeScript stops the command: "Given value abc for argument number is not of type Number"$/)
    assert.match(messages("$createGuild[Test;http://example.com/a.png]", "http-url")[0], /https:\/\/cdn\.discordapp\.com\/emojis\/undefined\.png/)
    assert.match(messages("$let[x;$ping]", "hidden-output")[0], /\$!ping does that/)
})

test("the variable rules stay quiet where variables can be used out of sight", () => {
    // A custom function's body can read the caller's variables.
    assert.ok(!rules("$get[a]", { customFunction: true }).includes("unset-variable"))
    // Code that runs other code nobody sees here.
    assert.ok(!rules("$let[a;1]$eval[$get[code]]").includes("unused-variable"))
    // A variable name built when the bot runs could be any variable.
    assert.ok(!rules("$let[a;1]$get[$get[which]]").some((r) => r === "unused-variable"))
    // Functions whose use of the variables is unknown (an extension known only from metadata).
    const custom = new FunctionTable([...table.byKey.values(), { name: "$fromMetadata", args: { required: true, fields: [{}] } }])
    assert.ok(!checkCode("$let[a;1]$fromMetadata[x]", custom, { values }).some((f) => f.rule === "unused-variable"))
})

test("without ForgeScript's resolvers, the built-in rules give the same answer for numbers and booleans", () => {
    const plain = new ValueChecker(null, null)
    for (const text of ["", "1", "1.5", "abc", " 2 ", "0x10", "1e3", "Infinity", "true", "false", "True", "NaN"]) {
        for (const type of ["Number", "Boolean"]) {
            const param = { name: "x", type, required: true }
            assert.equal(!!plain.check(param, text, "$f"), !!values.check(param, text, "$f"), `${type} ${JSON.stringify(text)}`)
        }
    }
})

test("a name that only compiles as a shorter function needing brackets is one error, with the likely name", () => {
    const found = checkCode("$authorI", table, { values })
    assert.deepEqual(found.map((f) => f.rule), ["missing-brackets"])
    assert.match(found[0].message, /^\$authorI is not a function here: ForgeScript reads \$author, which requires brackets, so the code does not compile\. Did you mean \$authorID\? Usage: \$author\[/)
    // A glued name that compiles is still a warning of its own.
    assert.deepEqual(rules("$pingms"), ["glued-name"])
})

test("brackets are not reported where a compile error decides how the rest is read", () => {
    // $getUserVar is unknown here: ForgeScript reads $get, which needs brackets, so nothing compiles.
    // Where the [ and ] around x belong is then a guess, and escaping them would change the code.
    assert.deepEqual(rules("$if[$getUserVar[x]==1;a;b]"), ["missing-brackets"])
    // A call that contains no error is still checked.
    assert.ok(rules("$get $description[[a](b)]").includes("unescaped-bracket"))
})

test("an empty argument is called empty", () => {
    assert.match(messages("$sendMessage[;hi]", "invalid-argument")[0], /^\$sendMessage: "channel ID" is empty, but must be an ID \(16 to 23 digits\)\. ForgeScript stops the command: "Given value  for argument channel ID is not of type Channel"$/)
})
