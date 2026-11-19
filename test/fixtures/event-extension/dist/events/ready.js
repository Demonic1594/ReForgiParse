"use strict"
// An event (an EventHandler) that passes no data: its commands run with no extras.
const { Interpreter } = require("@tryforge/forgescript")
exports.default = {
    name: "fixtureReady",
    register() {},
    listener() {
        for (const command of this.commands) Interpreter.run({ obj: {}, client: this, command, data: command.compiled.code })
    },
}
