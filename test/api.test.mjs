import test from "node:test"
import assert from "node:assert/strict"
import { KukuClient, parseCookies, cookieHeader, safeMessage, extractModels, beijingTomorrow } from "../lib/api.mjs"
const auth = { cookies: { BDUSS: "session-A", STOKEN: "scope-A" } }
const json = v => Response.json(v)

test("cookies: rejects missing credentials and header injection; filters unrelated hosts and expired cookies", () => {
  assert.throws(() => parseCookies("STOKEN=a"), /BDUSS/)
  assert.throws(() => parseCookies({ BDUSS: "a\r\nx-bad: yes" }), /BDUSS/)
  const c = parseCookies([
    { domain: "kuku.baidu.com", name: "STOKEN", value: "business" },
    { domain: ".baidu.com", name: "STOKEN", value: "passport" },
    { domain: ".baidu.com", name: "BDUSS", value: "good" },
    { domain: "attacker.baidu.com", name: "BDUSS", value: "bad" },
    { domain: ".baidu.com", name: "PTOKEN", value: "old", expires: 1 },
    { domain: "kuku.baidu.com", name: "BAIDUID", value: "wrong-path", path: "/other" },
  ])
  assert.equal(c.BDUSS, "good"); assert.equal(c.STOKEN, "business"); assert.equal(c.PTOKEN, undefined); assert.equal(c.BAIDUID, undefined)
  assert.match(cookieHeader(c), /gfprotpl=genflowpro/)
  assert.equal(parseCookies(JSON.stringify([{ name: "BDUSS", value: "foo==" }])).BDUSS, "foo==")
})
test("credentials never follow redirects or caller URLs", async () => {
  const c = new KukuClient(auth, { fetcher: async (url, init) => {
    assert.ok(url.startsWith("https://kuku.baidu.com/")); assert.equal(init.redirect, "error")
    assert.match(init.headers.Cookie, /BDUSS=session-A/); return json({ errno: 0, data: {} })
  } })
  await c.request("/test")
  await assert.rejects(c.request("//evil.test"), /非库库/)
  await assert.rejects(c.request("https://evil.test"), /非库库/)
})
test("account-scoped requests do not reuse another account's session or models", async () => {
  const fetcher = async (url, init) => {
    const a = init.headers.Cookie.includes("session-A") ? "A" : "B"
    if (url.includes("userreport")) return json({ errno: 0, data: { bdstoken: "token-" + a, uk: a, uinfo: "info-" + a } })
    assert.equal(new URL(url).searchParams.get("bdstoken"), "token-" + a)
    return json({ status: { code: 0 }, data: { model_list: [{ model_name: "model-" + a }] } })
  }
  const a = new KukuClient(auth, { fetcher }), b = new KukuClient({ cookies: { BDUSS: "session-B" } }, { fetcher })
  const [sa, sb] = await Promise.all([a.session(), b.session()])
  assert.equal((await a.models(sa))[0].id, "model-A"); assert.equal((await b.models(sb))[0].id, "model-B")
})
test("passport token exchange uses official endpoint and persists only in this client", async () => {
  let calls = 0
  const c = new KukuClient({ cookies: { BDUSS: "session-A", PTOKEN: "pt", STOKEN: "old" } }, { fetcher: async (url, init) => {
    calls++
    if (url.includes("passport.baidu.com")) { assert.match(init.body, /sig=[a-f0-9]{32}$/); assert.equal(init.redirect, "error"); return json({ errno: 0, stoken_list: { genflowpro: "new" } }) }
    if (calls === 1) return json({ errno: -6 })
    assert.match(init.headers.Cookie, /STOKEN=new/)
    return json({ errno: 0, data: { uk: 123, bdstoken: "token" } })
  } })
  assert.equal((await c.session()).uk, "123"); assert.equal(c.cookies.STOKEN, "new"); assert.equal(auth.cookies.STOKEN, "scope-A")
})
test("unknown balance is an error; genuine zero remains zero", async () => {
  const c = new KukuClient(auth, { fetcher: async () => json({ status: { code: 0 }, data: { list: [{ assetName: "duration", totalPoint: "90" }] } }) })
  await assert.rejects(c.balance(), /未返回积分/)
  c.fetcher = async () => json({ status: { code: 0 }, data: { list: [{ assetName: "token", totalPoint: "0" }] } })
  assert.equal((await c.balance()).balance, 0)
})
test("authentication errors and redaction", async () => {
  const c = new KukuClient(auth, { fetcher: async () => new Response("unauthorized", { status: 401 }) })
  await assert.rejects(c.session(), e => e.status === 401 && e.signIn === "expired")
  assert.equal(safeMessage(new Error("session-A BDUSS=SECRET STOKEN:OTHER"), auth.cookies), "[redacted] BDUSS=[redacted] STOKEN=[redacted]")
})
test("catalog extracts model identifiers, not display names or unrelated ids", () => {
  assert.deepEqual(extractModels({ id: "not-model", name: "not-model", list: [{ model_name: "real", model_display_name: "Real" }, { child: { modelName: "second" } }] }), [{ id: "real", name: "Real" }, { id: "second", name: "second" }])
})
test("Beijing day rollover is independent of machine timezone", () => {
  assert.equal(new Date(beijingTomorrow(Date.parse("2026-11-12T15:59:59Z"))).toISOString(), "2026-11-12T16:00:00.000Z")
})
