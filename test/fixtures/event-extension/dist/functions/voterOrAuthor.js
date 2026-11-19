"use strict"
// Falls back on the author: works in any command.
const { NativeFunction } = require("@tryforge/forgescript")
exports.default = new NativeFunction({
    name: "$fixtureVoterOrAuthor",
    description: "The voter, else the author",
    unwrap: false,
    execute(ctx) {
        return this.success(ctx.runtime.extras?.user ?? ctx.user?.id)
    },
})
