// Interactive, opt-in smoke test. Credentials stay in memory and are never logged.
import { writeFile } from "node:fs/promises"
import { KukuAuthPlugin } from "../index.mjs"
const plugin = await KukuAuthPlugin()
console.log("Opening a separate Kuku website sign-in window. Complete login there; credentials will not be printed or saved by this script.")
const flow = await plugin.auth.methods[0].authorize()
console.log("BROWSER_READY")
const result = await flow.callback()
if (result.type !== "success") { console.log(JSON.stringify({ login: false, error: result.error })); process.exitCode = 1 }
else {
  const { type, ...fields } = result, auth = { ...fields, type: "oauth" }
  const report = { testedAt: new Date().toISOString(), login: true }
  const getAuth = async () => auth
  try {
    const p = { id: "kuku", models: {} }
    const models = await plugin.provider.models(p, { auth })
    report.modelCount = Object.keys(models).length
  } catch { report.models = "failed" }
  const usage = await plugin.auth.usage(getAuth)
  report.balance = usage.error ? "failed" : "read successfully"
  const checkin = await plugin.auth.checkin(getAuth)
  report.checkin = checkin.outcome
  report.checkinMessage = checkin.message
  const loader = await plugin.auth.loader(getAuth)
  const response = await loader.fetch("https://kuku.baidu.com/v1/chat/completions", {
    method: "POST", body: JSON.stringify({ model: "auto", stream: false, messages: [{ role: "user", content: "只回复：连接成功" }] }),
  })
  const body = await response.json()
  report.chat = response.ok && !!body.choices?.[0]?.message?.content ? "passed" : "failed"
  report.chatStatus = response.status
  await writeFile(new URL("../validation.local.json", import.meta.url), JSON.stringify(report, null, 2) + "\n")
  console.log(JSON.stringify(report))
}
