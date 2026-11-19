"use strict"
// An extension's event (an EventHandler, as readNatives finds them): runs its commands with the vote as extras.
const { Interpreter } = require("@tryforge/forgescript")
exports.default = {
    name: "fixtureVoted",
    register() {},
    listener(vote) {
        for (const command of this.commands) Interpreter.run({ obj: {}, client: this, command, data: command.compiled.code, extras: vote })
    },
}
