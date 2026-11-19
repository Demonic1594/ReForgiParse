"use strict"
// Reads only its event's data: nothing to read in another event's command.
const { NativeFunction } = require("@tryforge/forgescript")
exports.default = new NativeFunction({
    name: "$fixtureVoteUser",
    description: "The user who voted",
    unwrap: false,
    execute(ctx) {
        return this.success(ctx.runtime.extras?.user)
    },
})
