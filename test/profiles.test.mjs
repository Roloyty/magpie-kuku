import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, readFile, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createProfile, bindProfile, ownedProfile, discardProfile, profilePath, lockProfile } from "../lib/profiles.mjs"
test("browser profiles survive successful login and remain bound to their account", async () => {
  const root = await mkdtemp(join(tmpdir(), "kuku-profile-test-"))
  try {
    const a = await createProfile(root), b = await createProfile(root)
    await bindProfile(a.id, "uid-A", root); await bindProfile(b.id, "uid-B", root)
    assert.equal(await ownedProfile(a.id, "uid-A", root), a.path)
    await assert.rejects(ownedProfile(a.id, "uid-B", root), /不一致/)
    const marker = await readFile(join(a.path, ".magpie-kuku-profile.json"), "utf8")
    assert.ok(!/BDUSS|STOKEN|access|refresh/.test(marker))
    await discardProfile(a.id, root)
    assert.ok((await stat(b.path)).isDirectory())
  } finally { await rm(root, { recursive: true, force: true }) }
})
test("profile ids cannot escape the plugin directory, and concurrent reuse is refused", () => {
  for (const id of ["../other", "C:/Users", "kuku-../../../", "", undefined]) assert.throws(() => profilePath(id))
  const release = lockProfile("kuku-123456")
  assert.throws(() => lockProfile("kuku-123456"), /正在使用/)
  release(); lockProfile("kuku-123456")()
})
