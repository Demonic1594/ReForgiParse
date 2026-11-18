module.exports = [{
    name: "ping",
    type: "messageCreate",
    // code: "$notChecked[" inside a comment is skipped
    code: `Pong! $pingms
$sendMessage
$if[$get[a]==1;yes;no;extra]
$addOne[5] $greet[Bob]
Costs $5. Escaped: \\$ping. ${"dynamic"}$authorI`
}, {
    name: "unclosed",
    type: "messageCreate",
    code: "$get[a"
}, {
    name: "typo",
    type: "messageCreat",
    code: "$ping[oops] $sendMesage[$channelID;hi] $addOne $addField[Coins]"
}, {
    data: { name: "slash", type: 1 },
    code: "ok"
}]
