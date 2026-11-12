// Credentials arrive through process IPC only; never written to disk or logged.
import { writeFile } from "node:fs/promises"
import { KukuAuthPlugin } from "../index.mjs"
process.once("message", async auth => {
  const plugin = await KukuAuthPlugin(), report = { testedAt: new Date().toISOString(), login: true }
  const getAuth = async () => auth
  try { const models = await plugin.provider.models({ id: "kuku", models: {} }, { auth }); report.modelCount = Object.keys(models).length }
  catch { report.models = "failed" }
  const usage = await plugin.auth.usage(getAuth)
  report.balance = usage.error ? "failed" : "read successfully"
  const checkin = await plugin.auth.checkin(getAuth)
  report.checkin = checkin.outcome; report.checkinMessage = checkin.message
  try {
    const loader = await plugin.auth.loader(getAuth)
    const response = await loader.fetch("https://kuku.baidu.com/v1/chat/completions", { method: "POST",
      body: JSON.stringify({ model: "auto", stream: false, messages: [{ role: "user", content: "只回复：连接成功" }] }) })
    const body = await response.json()
    report.chat = response.ok && !!body.choices?.[0]?.message?.content ? "passed" : "failed"
    report.chatStatus = response.status
  } catch { report.chat = "failed" }
  await writeFile(new URL("../validation.local.json", import.meta.url), JSON.stringify(report, null, 2) + "\n")
  console.log(JSON.stringify(report)); process.disconnect()
})
