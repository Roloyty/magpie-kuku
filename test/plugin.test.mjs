import test from "node:test"
import assert from "node:assert/strict"
import { KukuAuthPlugin } from "../index.mjs"
import { CDP, safeDebugSocket, removeLoginProfile, browserCandidates } from "../lib/browser.mjs"
test("Magpie/OpenCode entry exports only plugin functions and config advertises text capability", async () => {
  const mod = await import("../opencode.mjs")
  assert.ok(Object.values(mod).every(v => typeof v === "function"))
  const p = await KukuAuthPlugin(), cfg = {}; await p.config(cfg)
  assert.equal(p.auth.provider, "kuku"); assert.equal(p.provider.id, "kuku")
  assert.equal(cfg.provider.kuku.models.auto.tool_call, false)
  assert.ok(p.auth.methods[0].label.includes("网页登录")); assert.equal(typeof p.auth.checkin, "function")
  const v2 = await import("../opencode2.mjs"); assert.equal(typeof v2.default.setup, "function")
})
test("not signed in returns 401 and no model request", async () => {
  const p = await KukuAuthPlugin(), loader = await p.auth.loader(async () => undefined)
  assert.equal((await loader.fetch("https://kuku.baidu.com/v1/chat/completions", { body: "{}" })).status, 401)
})
test("bad manual cookie cannot echo credentials into sign-in errors", async () => {
  const p = await KukuAuthPlugin(), auth = await p.auth.methods[1].authorize()
  const result = await auth.callback('STOKEN=super-secret\nvalue')
  assert.equal(result.type, "failed"); assert.doesNotMatch(JSON.stringify(result), /super-secret|bad/)
})
test("debugging is loopback-only and profile cleanup cannot target another directory", async () => {
  assert.ok(safeDebugSocket("ws://127.0.0.1:1234/devtools/browser/123"))
  assert.throws(() => safeDebugSocket("ws://evil.test:1234/devtools/browser/123"))
  assert.throws(() => safeDebugSocket("wss://127.0.0.1:1234/devtools/browser/123"))
  await assert.rejects(removeLoginProfile("C:/Users"), /拒绝清理/)
  assert.ok(browserCandidates("win32", { PROGRAMFILES: "C:/Program Files" }).some(x => x.includes("Edge")))
})
test("CDP rejects pending calls on browser close rather than hanging", async () => {
  class Socket extends EventTarget { send() {} }
  const socket = new Socket(), cdp = new CDP(socket, 500)
  const pending = cdp.send("Storage.getCookies")
  socket.dispatchEvent(new Event("close"))
  await assert.rejects(pending, /窗口已关闭/)
  assert.equal(cdp.pending.size, 0)
})
