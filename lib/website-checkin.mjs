// SPDX-License-Identifier: AGPL-3.0-only
// When the legacy token endpoint is empty, use the official activity page's
// own button and JavaScript. Never synthesize risk-control proofs or solve a captcha.
import { spawn } from "node:child_process"
import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { CDP, findBrowser, removeLoginProfile } from "./browser.mjs"
import { parseCookies, ACTIVITY_PAGE } from "./api.mjs"

// Select only the official daily sign-in button observed on the activity page.
// No lottery, membership, make-up, invitation or reward-claim button is clicked.
export const pageStateExpression = `(() => {
  if (location.origin !== 'https://kuku.baidu.com' || !location.pathname.startsWith('/operation/activitys/kukuPcSignAct/')) return {state:'wrong-page'};
  const button = document.querySelector('button.pc-sign-btn');
  const text = button?.innerText?.trim() || '';
  if (text === '今日已签') return {state:'signed'};
  if (text === '登录领奖') return {state:'login'};
  const visible = e => e && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0;
  if ([...document.querySelectorAll('iframe[src*="captcha"], .geetest_panel, .vcode-dialog, .verify-dialog')].some(visible)) return {state:'captcha'};
  const tip = document.querySelector('.pc-sign-tip__text')?.innerText || '';
  if (/验证|风控|频繁|异常/.test(tip)) return {state:'captcha'};
  if (text === '立即签到' && !window.__magpieKukuPressed && visible(button)) {
    window.__magpieKukuPressed = true;
    button.click();
    return {state:'pressed'};
  }
  if (window.__magpieKukuPressed && /失败|结束/.test(tip)) return {state:'failed'};
  return {state:'waiting'};
})()`

export async function websiteCheckin(rawCookies, { signal, timeout = 25000 } = {}) {
  const cookies = parseCookies(rawCookies), executable = await findBrowser()
  signal?.throwIfAborted()
  const profile = await mkdtemp(join(tmpdir(), "magpie-kuku-login-"))
  const child = spawn(executable, ["--headless=new", "--user-data-dir=" + profile,
    "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0", "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore", windowsHide: true })
  let closed = false, launchError, cdp
  child.on("exit", () => { closed = true }); child.on("error", e => { launchError = e })
  const controller = new AbortController(), abort = () => controller.abort()
  signal?.addEventListener("abort", abort, { once: true })
  const timer = setTimeout(abort, timeout)
  try {
    let lines
    while (!controller.signal.aborted) {
      if (closed || launchError) throw new Error("签到浏览器无法启动")
      try { lines = (await readFile(join(profile, "DevToolsActivePort"), "utf8")).trim().split(/\r?\n/); break } catch {}
      await delay(200, undefined, { signal: controller.signal })
    }
    controller.signal.throwIfAborted()
    if (!lines || !/^\d+$/.test(lines[0])) throw new Error("签到浏览器无法连接")
    cdp = await CDP.open(`ws://127.0.0.1:${lines[0]}${lines[1]}`)
    const { targetInfos } = await cdp.send("Target.getTargets")
    const target = targetInfos.find(t => t.type === "page")
    if (!target) throw new Error("签到浏览器没有页面")
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId: target.targetId, flatten: true })
    const page = (method, params) => cdp.send(method, params, sessionId)
    await page("Network.enable", {})
    await page("Network.setCookies", { cookies: Object.entries(cookies).map(([name, value]) => ({ name, value,
      domain: name === "STOKEN" ? ".kuku.baidu.com" : ".baidu.com", path: "/", secure: true, httpOnly: name !== "BAIDUID" })) })
    await page("Page.navigate", { url: ACTIVITY_PAGE })
    while (!controller.signal.aborted) {
      if (closed) return { state: "failed" }
      const v = await page("Runtime.evaluate", { expression: pageStateExpression, returnByValue: true })
      const state = v.result?.value?.state
      if (["signed", "captcha", "login", "failed"].includes(state)) return { state }
      await delay(500, undefined, { signal: controller.signal })
    }
    return { state: "timeout" }
  } catch (e) {
    if (e.name === "AbortError") return { state: "timeout" }
    throw e
  } finally {
    clearTimeout(timer); signal?.removeEventListener("abort", abort)
    if (cdp) { try { await cdp.send("Browser.close") } catch {}; cdp.close() }
    if (!closed) child.kill()
    try { await removeLoginProfile(profile) } catch {}
  }
}
