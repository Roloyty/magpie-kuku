import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { KukuAuthPlugin } from "../index.mjs"
const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"))
const mod = await import("../opencode.mjs")
assert.ok(Object.values(mod).every(v => typeof v === "function"))
const hooks = await KukuAuthPlugin({ client: {} }), config = { provider: {} }
await hooks.config(config)
assert.equal(hooks.auth.provider, hooks.provider.id)
assert.equal(hooks.auth.single, undefined)
assert.equal(typeof hooks.auth.loader, "function")
assert.equal(typeof hooks.auth.usage, "function")
assert.equal(typeof hooks.auth.checkin, "function")
for (const m of hooks.auth.methods) { assert.equal(m.type, "oauth"); assert.equal(typeof m.authorize, "function") }
assert.ok(config.provider.kuku.npm)
assert.ok(config.provider.kuku.models.auto)
const v2 = await import("../opencode2.mjs")
assert.equal(v2.default.id, pkg.name); assert.equal(typeof v2.default.setup, "function")
for (const file of ["opencode.mjs", "opencode2.mjs", "index.mjs", "LICENSE", "README.md", "THIRD_PARTY_NOTICES.md"])
  assert.ok((await readFile(new URL("../" + file, import.meta.url))).length > 0, file)
console.log("PASS: Magpie provider hooks, multi-account contract, package entries and required documentation")
