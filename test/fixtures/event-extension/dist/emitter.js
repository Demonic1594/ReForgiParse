"use strict"
// Where the events are emitted: what each gives its listener.
exports.vote = (emitter, user) => emitter.emit("fixtureVoted", { user, oldValue: "0" })
exports.ready = (emitter) => emitter.emit("fixtureReady")
