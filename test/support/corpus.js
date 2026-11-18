"use strict"
// Code to compare against ForgeScript's compiler: a hand-written set that covers the grammar, plus,
// when FORGEPARSE_CORPUS names a folder, every ```fs / ```forgescript block and every `code:`
// string in the .md, .js and .fsx files under it (for example a bot, or a knowledge base).
const fs = require("node:fs")
const path = require("node:path")

const BUILT_IN = [
    "",
    "plain text, no functions",
    "$ping",
    "Pong! $pingms",
    "$PING $Ping $pInG",
    "$authorID $AUTHORID",
    "$sendMessage[$channelID;Hello <@$authorID>!]",
    "$if[$get[a]==1;yes;no]",
    "$if[$get[a]!=;empty;not empty]",
    "$if[1<=2;$if[3>=4;a;b];c]",
    "$if[a<b>c;x;y]",
    "$if[no operator here;x;y]",
    "$if[==;x;y]",
    "$if[$get[x]<;x;y]",
    "$if[a=b;x;y]",
    "$if[a!b;x;y]",
    "$if[$sum[1;2]>$sum[0;1];bigger;smaller]",
    "$let[a;1]$let[b;$sum[$get[a];1]]$get[b]",
    "$!sendMessage[$channelID;quiet]",
    "$#ping",
    "$!#ping",
    "$@[1]ping",
    "$@[]ping",
    "$@[a;b]get[x]",
    "$!#@[2]get[x]",
    "\\$ping is escaped",
    "$get[\\$ping $ping]",
    "$if[\\$get[a]==$get[a];x;\\$ping$ping]",
    "\\$ping$ping \\\\$ping",
    "\\\\$ping after an escaped backslash",
    "a \\; b \\] c \\[ d",
    "$get[a\\;b]",
    "$get[a\\]b]",
    "ends with a backslash \\",
    "$get[a\\",
    "$get[a",
    "$get[a;",
    "$sendMessage[a;b",
    "$if[1==1;a",
    "$if[1==1;a;b;c]",
    "$sendMessage",
    "a\n  $sendMessage",
    "line 1\nline 2\n$get[",
    "😀 $get[😀",
    "😀😀\n😀 $sendMessage",
    "$get[[nested]]",
    "$get[a]]",
    "]]]];;;[[[",
    "$ping[not arguments]",
    "$c[a comment with $ping and $get[x] inside]",
    "$c[$sendMessage]",
    "$jsonParse[{\"a\": [1, 2, 3]}]",
    "$json[a;b;c;d;e;f]",
    "$arrayCreate[x;a;b;c;d;e;f;g;h]",
    "$djsEval[`${1 + 1}`]",
    "$httpRequest[https://example.com/a?b=c&d=e;GET]",
    "$color[#ff0000]$title[Hi]$description[$username]",
    "$onlyIf[$hasPerms[$guildID;$authorID;Administrator];You are not an admin]",
    "$try[$get[x];$c[nothing]]",
    "$while[$get[i]<10;$letSum[i;1]]",
    "$switch[$get[x];$case[1;one]$case[2;two]$case[default;other]]",
    "$!$ping",
    "$$ping",
    "$ ping",
    "$#",
    "$@[",
    "$@[x",
    "$@[x\n]ping",
    "$giveRole $pingms $authorIDx",
    "[SYSTEM_FUNCTION(0)] $ping \\[SYSTEM_FUNCTION(1)]",
    "`backticks` and ${template} and \\\\",
]

function blocks(text) {
    const out = []
    for (const m of text.matchAll(/```(?:fs|forgescript|fsx)\n([\s\S]*?)```/g)) out.push(m[1].replace(/\n$/, ""))
    for (const m of text.matchAll(/\bcode\s*:\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/g)) {
        try {
            out.push(m[1] === "`" ? m[2] : JSON.parse(`"${m[2].replace(/"/g, '\\"').replace(/\\'/g, "'")}"`))
        } catch {
            // Not a plain string literal (concatenation, interpolation): skip it.
        }
    }
    return out
}

function* files(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === "node_modules" || e.name.startsWith(".")) continue
        const p = path.join(dir, e.name)
        if (e.isDirectory()) yield* files(p)
        else if (/\.(md|js|fsx|fs)$/.test(e.name)) yield p
    }
}

function corpus() {
    const out = [...BUILT_IN]
    const dir = process.env.FORGEPARSE_CORPUS
    if (dir) {
        for (const f of files(dir)) {
            const text = fs.readFileSync(f, "utf8")
            if (/\.(fsx|fs)$/.test(f)) out.push(text)
            else out.push(...blocks(text))
        }
    }
    return [...new Set(out)]
}

module.exports = { corpus, BUILT_IN }
