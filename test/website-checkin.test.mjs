import test from "node:test"
import assert from "node:assert/strict"
import vm from "node:vm"
import { pageStateExpression } from "../lib/website-checkin.mjs"
function dom(text, tip = "", challenge = false) {
  let clicks = 0
  const button = { innerText: text, click: () => clicks++, getBoundingClientRect: () => ({ width: 100, height: 30 }) }
  const context = { location: { origin: "https://kuku.baidu.com", pathname: "/operation/activitys/kukuPcSignAct/main" }, window: {},
    document: { querySelector: s => s === "button.pc-sign-btn" ? button : { innerText: tip },
      querySelectorAll: () => challenge ? [button] : [] } }
  return { context, clicks: () => clicks }
}
test("official website button is pressed at most once; signed and challenge states are untouched", () => {
  for (const [text, expected, count] of [["立即签到", "pressed", 1], ["今日已签", "signed", 0], ["登录领奖", "login", 0], ["去抽奖", "waiting", 0]]) {
    const d = dom(text)
    assert.equal(vm.runInNewContext(pageStateExpression, d.context).state, expected)
    vm.runInNewContext(pageStateExpression, d.context)
    assert.equal(d.clicks(), count)
  }
  const d = dom("立即签到", "", true)
  assert.equal(vm.runInNewContext(pageStateExpression, d.context).state, "captcha"); assert.equal(d.clicks(), 0)
})
test("refuses to interact on other origins or pages", () => {
  const d = dom("立即签到"); d.context.location.origin = "https://evil.test"
  assert.equal(vm.runInNewContext(pageStateExpression, d.context).state, "wrong-page"); assert.equal(d.clicks(), 0)
})
