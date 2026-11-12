// Exercise Magpie's actual host.js in an isolated temp auth store. No live account.
import { spawn } from "node:child_process"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { createInterface } from "node:readline"
import assert from "node:assert/strict"
const host = process.argv[2]
if (!host) throw new Error("usage: node scripts/host-smoke.mjs <magpie internal/plugin/host.js> [bun executable]")
const temp = await mkdtemp(join(tmpdir(), "kuku-host-test-"))
const child = spawn(process.argv[3] ?? "bun", ["--preload", resolve("test/host-preload.mjs"), resolve(host)], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true })
let next = 0, errors = ""
const pending = new Map()
child.stderr.on("data", d => { errors += d })
createInterface({ input: child.stdout }).on("line", line => {
  let m; try { m = JSON.parse(line) } catch { return }
  const p = pending.get(m.id)
  if (!p) return
  pending.delete(m.id); clearTimeout(p.timer)
  m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result)
})
function rpc(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++next, timer = setTimeout(() => reject(new Error(`RPC ${method} timed out: ${errors}`)), 10000)
    pending.set(id, { resolve, reject, timer })
    child.stdin.write(JSON.stringify({ id, method, params }) + "\n")
  })
}
try {
  const init = await rpc("init", { authPath: join(temp, "auth.json"), directory: temp, plugins: [{ spec: "magpie-kuku-auth", target: process.cwd() }] })
  assert.ok(!init.plugins[0].error, JSON.stringify(init))
  const before = await rpc("providers")
  assert.equal(before[0].id, "kuku"); assert.equal(before[0].checkin, true); assert.equal(before[0].single, false)
  const login = async who => {
    const a = await rpc("authorize", { provider: "kuku", method: 1 })
    const b = await rpc("callback", { session: a.session, code: `BDUSS=synthetic-${who}; STOKEN=scope-${who}` })
    assert.equal(b.ok, true); return b.account
  }
  const a = await login("A"), b = await login("B")
  assert.notEqual(a, b)
  assert.equal(await login("A"), a, "logging back in updates the same UID rather than duplicating it")
  const providers = await rpc("providers")
  assert.equal(providers[0].accounts.length, 2)
  assert.deepEqual(providers[0].models.map(x => x.id).sort(), ["model-A", "model-B"])
  const [ua, ub] = await Promise.all([rpc("usage", { provider: "kuku", account: a }), rpc("usage", { provider: "kuku", account: b })])
  assert.match(JSON.stringify(ua), /100 积分/); assert.match(JSON.stringify(ub), /200 积分/)
  const ca = await rpc("checkin", { provider: "kuku", account: a }), cb = await rpc("checkin", { provider: "kuku", account: b })
  assert.equal(ca.outcome, "done"); assert.equal(cb.outcome, "claimed")
  const kept = JSON.parse(await readFile(join(temp, "auth.json"), "utf8"))
  assert.equal(Object.keys(kept).length, 2)
  console.log("PASS: actual Magpie host loads plugin; login saves two isolated UIDs; repeat login deduplicates; per-account models, balances and check-in hooks work")
} finally { child.kill(); for (const p of pending.values()) clearTimeout(p.timer); await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
