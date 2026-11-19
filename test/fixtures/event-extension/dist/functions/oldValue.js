"use strict"
// Reads its event's data without a check: stops a command of another event with a TypeError.
const { NativeFunction } = require("@tryforge/forgescript")
exports.default = new NativeFunction({
    name: "$fixtureOldValue",
    description: "The old value",
    unwrap: false,
    execute(ctx) {
        return this.success(ctx.runtime.extras.oldValue)
    },
})
