// Interactive live smoke test. Credentials stay in memory and are never logged.
import { fork } from "node:child_process"
import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"
import { KukuAuthPlugin } from "../index.mjs"
const plugin = await KukuAuthPlugin()
console.log("Opening the Kuku website login window. Credentials stay in memory.")
const flow = await plugin.auth.methods[0].authorize()
console.log("BROWSER_READY")
const result = await flow.callback()
if (result.type !== "success") { console.log(JSON.stringify({ login: false, error: result.error })); process.exitCode = 1 }
else {
  const { type, ...fields } = result, auth = { ...fields, type: "oauth" }
  const run = () => new Promise((resolve, reject) => {
    const child = fork(fileURLToPath(new URL("./live-check-worker.mjs", import.meta.url)), [], { silent: true, windowsHide: true })
    child.stdout.pipe(process.stdout)
    child.stderr.on("data", () => {})
    child.once("error", reject)
    child.once("exit", code => code ? reject(new Error("live worker failed")) : resolve())
    child.send(auth)
  })
  await run()
  if (process.argv.includes("--hold")) {
    console.log("AUTH_IN_MEMORY: send retest to verify edited source, or exit to discard credentials.")
    const timer = setTimeout(() => { console.log("Live test session expired; credentials discarded."); process.exit(0) }, 15 * 60 * 1000)
    const input = createInterface({ input: process.stdin, terminal: false })
    for await (const line of input) {
      if (line.trim() === "exit") break
      if (line.trim() === "retest") await run()
    }
    clearTimeout(timer); input.close()
  }
}
