"use strict"
// An extension function defined in code only, as the official extensions on npm ship them.
const { NativeFunction, ArgType } = require("@tryforge/forgescript")
exports.default = new NativeFunction({
    name: "$fixtureDouble",
    description: "Doubles a number",
    brackets: true,
    unwrap: true,
    args: [{ name: "number", description: "", type: ArgType.Number, required: true, rest: false }],
    execute(ctx, [n]) {
        return this.success(n * 2)
    },
})
