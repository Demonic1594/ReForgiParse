module.exports = {
    name: "clean",
    type: "messageCreate",
    code: `$let[a;$addOne[1]]$if[$get[a]==2;$sendMessage[$channelID;two]]$!ping $greet $c[$5 is fine]`
}
