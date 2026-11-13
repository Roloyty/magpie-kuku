import test from "node:test"
import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { closeBrowser } from "../lib/browser.mjs"

test("profile cleanup waits for a graceful Chrome exit so storage is flushed", async () => {
  const child = new EventEmitter()
  child.exitCode = null; child.signalCode = null
  let flushed = false, killed = false
  child.kill = () => { killed = true }
  const cdp = { send: async method => {
    assert.equal(method, "Browser.close")
    setTimeout(() => { flushed = true; child.exitCode = 0; child.emit("exit", 0) }, 20)
  }, close() {} }
  await closeBrowser(child, cdp, { grace: 500 })
  assert.equal(flushed, true); assert.equal(killed, false)
  assert.equal(child.listenerCount("exit"), 0)
})

test("an unresponsive owned browser is killed after the graceful shutdown deadline", async () => {
  const child = new EventEmitter()
  child.exitCode = null; child.signalCode = null
  let killed = false
  child.kill = () => { killed = true; child.signalCode = "SIGTERM"; child.emit("exit", null, "SIGTERM") }
  await closeBrowser(child, { send: async () => { throw new Error("closed") }, close() {} }, { grace: 10 })
  assert.equal(killed, true); assert.equal(child.listenerCount("exit"), 0)
})
