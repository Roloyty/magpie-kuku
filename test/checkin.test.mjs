import test from "node:test"
import assert from "node:assert/strict"
import { checkin, extractJsToken } from "../lib/checkin.mjs"
const conf = { errno: 0, data: [{ conf_value: { activityTid: "campaign", signPoint: "10" } }] }
function fake(overrides = {}) {
  const calls = []
  const client = { calls, request: async (path, init) => {
    calls.push({ path, init })
    if (path.includes("conf?")) return overrides.conf ?? conf
    if (path.includes("homepage")) return overrides.home ?? { errno: 0, data: { signed_today: false, continuous_days: 2 } }
    if (path.includes("getJsToken")) return overrides.token ?? { data: { jsToken: encodeURIComponent('function fn(a){};fn("A1B2")') } }
    if (path.includes("signin?")) return overrides.sign ?? { errno: 0, data: { signed_today: true, continuous: 3 } }
    if (path.includes("homenew")) return overrides.legacy ?? { errno: 0, data: { activities: [] } }
    if (path.includes("taskComplete")) { assert.equal(init.form.task_type, "LOGIN"); return overrides.claim }
    throw new Error("unexpected request")
  } }
  return client
}
test("claims configured activity once with vendor token and reports credit", async () => {
  const c = fake(), result = await checkin(c)
  assert.equal(result.outcome, "claimed"); assert.equal(result.credit, 10); assert.equal(result.streak, 3)
  assert.match(c.calls.at(-1).path, /jsToken=A1B2&aid=15459/); assert.equal(c.calls.at(-1).init.activity, true)
})
test("already checked in never presses the signin endpoint", async () => {
  const c = fake({ home: { errno: 0, data: { signed_today: true } } })
  assert.equal((await checkin(c)).outcome, "done"); assert.equal(c.calls.length, 2)
})
test("HTTP/business success without confirmation does not report claimed", async () => {
  const c = fake({ sign: { errno: 0, data: {} } })
  assert.equal((await checkin(c)).outcome, "failed"); assert.equal(c.calls.filter(x => x.path.includes("signin?")).length, 1)
})
test("risk control asks for website verification without retrying or falling back", async () => {
  const c = fake({ sign: { errno: 8002, errmsg: "verify" } })
  assert.equal((await checkin(c)).outcome, "captcha"); assert.equal(c.calls.length, 4)
})
test("expired auth does not masquerade as campaign unavailability", async () => {
  const c = fake({ home: { errno: -6, errmsg: "未登录" } })
  await assert.rejects(checkin(c), e => e.signIn === "expired"); assert.equal(c.calls.length, 2)
})
test("malformed activity state is not claimed; token code is never executed", async () => {
  assert.equal(extractJsToken('globalThis.hacked=true; eval("bad code")'), null)
  assert.equal(extractJsToken('fn("OK");evil()'), null)
  const c = fake({ home: { errno: 0, data: {} } })
  assert.equal((await checkin(c)).outcome, "failed"); assert.equal(c.calls.length, 2)
})
test("inactive legacy activity never claims chat or invitation tasks", async () => {
  const c = fake({ conf: { errno: 0, data: [] }, legacy: { errno: 0, data: { activities: [{ tabs: [{ tasks: [{ task_type: "CHAT" }, { task_type: "INVITE_VISIT" }] }] }] } } })
  assert.equal((await checkin(c)).outcome, "inactive"); assert.ok(!c.calls.some(x => x.path.includes("taskComplete")))
})
test("legacy LOGIN distinguishes reward zero from a confirmed positive reward", async () => {
  for (const reward of [0, 20]) {
    const c = fake({ conf: { errno: 0, data: [] }, legacy: { errno: 0, data: { activities: [{ tabs: [{ tasks: [{ task_type: "LOGIN", task_status: "UNFINISHED" }] }] }] } }, claim: { errno: 0, data: { complete_status: "SUCCESS", reward_point: reward } } })
    assert.equal((await checkin(c)).outcome, reward ? "claimed" : "done")
  }
})
test("empty legacy token uses the official webpage, and requires server-side confirmation", async () => {
  for (const success of [false, true]) {
    const c = fake({ token: { errno: 0, data: { jsToken: null } } })
    const request = c.request; let checked = false
    c.request = async (path, init) => checked && path.includes('homepage')
      ? { errno: 0, data: { signed_today: success, continuous_days: 4 } } : request(path, init)
    let calls = 0
    const result = await checkin(c, { browserCheckin: async () => { checked = true; calls++; return { state: 'signed' } } })
    assert.equal(calls, 1); assert.equal(result.outcome, success ? 'claimed' : 'failed')
  }
})
test("website risk is exposed as captcha and existing browser identity is passed through", async () => {
  const c = fake({ token: { errno: 0, data: { jsToken: null } } })
  c.browserProfile = "kuku-123456"; c.accountId = "uid-A"
  const r = await checkin(c, { browserCheckin: async (_cookies, options) => {
    assert.equal(options.profile, "kuku-123456"); assert.equal(options.uid, "uid-A")
    return { state: "captcha", code: 8001, message: "账号存在风险" }
  } })
  assert.equal(r.outcome, "captcha"); assert.match(r.message, /8001.*风险/)
})

test("successful website submission waits for server confirmation without submitting twice", async () => {
  const c = fake({ token: { errno: 0, data: { jsToken: null } } })
  const request = c.request
  let submitted = false, reads = 0, clicks = 0
  c.request = async (path, init) => submitted && path.includes("homepage")
    ? { errno: 0, data: { signed_today: ++reads >= 2 } } : request(path, init)
  const result = await checkin(c, { browserCheckin: async () => {
    submitted = true; clicks++; return { state: "submitted" }
  } })
  assert.equal(result.outcome, "claimed"); assert.equal(clicks, 1); assert.equal(reads, 2)
})
