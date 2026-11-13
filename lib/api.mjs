// SPDX-License-Identifier: AGPL-3.0-only
// Protocol adapted from ProvidersPlugin/Agent2Providers (AGPL-3.0).
import { createHash } from "node:crypto"

export const ORIGIN = "https://kuku.baidu.com"
export const WEB_QUERY = "clienttype=400&app_id=123971023&web=1&channel=chunlei&version=1.4.4"
export const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36"
export const ACTIVITY_PAGE = `${ORIGIN}/operation/activitys/kukuPcSignAct/main`
const COOKIE_NAMES = new Set(["BDUSS", "STOKEN", "PTOKEN", "BDUSS_BFESS", "PTOKEN_BFESS", "BAIDUID"])

export class KukuError extends Error {
  constructor(message, status = 502, signIn) { super(message); this.status = status; this.signIn = signIn }
}
export function parseCookies(raw) {
  const out = Object.create(null)
  const put = (name, value) => {
    if (COOKIE_NAMES.has(name) && typeof value === "string" && value && !/[\r\n;]/.test(value)) out[name] = value
  }
  if (Array.isArray(raw)) {
    // Host-specific cookies win over parent-domain cookies with the same name.
    for (const c of [...raw].sort((a, b) => String(a.domain ?? "").length - String(b.domain ?? "").length)) {
      const domain = String(c.domain ?? "").replace(/^\./, "")
      if (domain && !(domain === "baidu.com" || domain === "kuku.baidu.com")) continue
      if (typeof c.expires === "number" && c.expires > 0 && c.expires * 1000 <= Date.now()) continue
      if (c.path && !"/genflowpro".startsWith(c.path)) continue
      put(c.name, c.value)
    }
  } else if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw)) put(k, v)
  } else if (typeof raw === "string") {
    const s = raw.trim()
    if (s.startsWith("[") || s.startsWith("{")) return parseCookies(JSON.parse(s))
    for (const part of s.replace(/^Cookie:\s*/i, "").split(";")) {
      const i = part.indexOf("=")
      if (i > 0) put(part.slice(0, i).trim(), part.slice(i + 1).trim())
    }
  }
  if (!out.BDUSS) throw new KukuError("缺少库库登录 Cookie（BDUSS），请重新登录", 401, "expired")
  return out
}
export function cookieHeader(cookies) {
  return Object.entries(parseCookies(cookies)).map(([k, v]) => `${k}=${v}`).join("; ") + "; gfprotpl=genflowpro"
}
export function safeMessage(error, cookies = {}) {
  let msg = String(error?.message ?? error ?? "未知错误")
  for (const value of Object.values(cookies)) if (typeof value === "string" && value) msg = msg.split(value).join("[redacted]")
  return msg.replace(/(BDUSS|STOKEN|PTOKEN|bdstoken|uinfo)(?:_BFESS)?\s*[=:]\s*[^\s;&"']+/gi, "$1=[redacted]").slice(0, 300)
}
export const beijingTomorrow = (now = Date.now()) => (Math.floor((now + 28800000) / 86400000) + 1) * 86400000 - 28800000
export const numberOrNull = (v) => v !== "" && v != null && Number.isFinite(Number(v)) ? Number(v) : null
export function codeOf(v) { return v?.status?.code ?? v?.errno ?? v?.error_code }
export function assertOK(value, label) {
  const code = codeOf(value)
  if (code == null || Number(code) !== 0) {
    const msg = String(value?.status?.msg ?? value?.errmsg ?? value?.show_msg ?? value?.message ?? "响应格式异常")
    const expired = [-6, -7, 110, 111].includes(Number(code)) || /未登录|登录.*失效|登录.*过期/.test(msg)
    throw new KukuError(`${label}失败（${code ?? "缺少状态码"}）：${msg}`, expired ? 401 : 502, expired ? "expired" : undefined)
  }
  return value.data
}

export class KukuClient {
  constructor(auth, { fetcher = globalThis.fetch, signal } = {}) {
    this.cookies = parseCookies(auth?.cookies ?? auth?.access)
    this.browserProfile = auth?.browserProfile
    this.accountId = auth?.uid ?? auth?.accountId
    this.fetcher = fetcher
    this.signal = signal
  }
  async request(path, { method = "GET", json, form, activity = false, stream = false, timeout = 30000 } = {}) {
    // Never forward a Baidu session to a caller-controlled host or redirect.
    if (!path.startsWith("/") || path.startsWith("//")) throw new KukuError("拒绝非库库地址", 400)
    const signal = AbortSignal.any([...(this.signal ? [this.signal] : []), AbortSignal.timeout(timeout)])
    const headers = { Cookie: cookieHeader(this.cookies), "User-Agent": UA, Origin: ORIGIN,
      Referer: activity ? ACTIVITY_PAGE : `${ORIGIN}/genflowpro`, "Accept-Language": "zh-CN,zh;q=0.9" }
    let body
    if (json !== undefined) { body = JSON.stringify(json); headers["Content-Type"] = "application/json;charset=utf-8" }
    if (form !== undefined) { body = new URLSearchParams(form).toString(); headers["Content-Type"] = "application/x-www-form-urlencoded;charset=UTF-8" }
    if (stream) headers.Accept = "text/event-stream"
    const res = await this.fetcher(ORIGIN + path, { method, headers, body, signal, redirect: "error" })
    if (res.status === 401) throw new KukuError("库库登录态已失效，请重新登录", 401, "expired")
    if (!res.ok) throw new KukuError(`库库接口返回 HTTP ${res.status}`, res.status === 429 ? 429 : 502)
    if (stream) {
      if (!res.headers.get("content-type")?.includes("text/event-stream")) throw new KukuError("库库未返回对话事件流，请在官网检查账号状态")
      return res
    }
    try { return await res.json() } catch { throw new KukuError("库库接口返回了无法解析的内容，请在官网检查登录或验证提示") }
  }
  async exchangeStoken() {
    const { BDUSS, PTOKEN } = this.cookies
    if (!PTOKEN) return false
    const fields = `appid=1&bduss=${BDUSS}&ptoken=${PTOKEN}&return_type=1&tpl=genflowpro&tpl_list=genflowpro|netdisk`
    const sig = createHash("md5").update(`${fields}&sign_key=34868b316de55815273b2616954b0286`).digest("hex")
    const res = await this.fetcher("https://passport.baidu.com/v3/login/api/auth", {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(20000),
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8", Origin: ORIGIN,
        Referer: `${ORIGIN}/genflowpro`, "User-Agent": "genflow;1.6.5;PC;PC-Windows;10.0.26200;GenFlowPro" },
      body: `${fields}&sig=${sig}`,
    })
    if (!res.ok) return false
    const v = await res.json()
    if (Number(v.errno) !== 0 || !v.stoken_list?.genflowpro) return false
    this.cookies.STOKEN = v.stoken_list.genflowpro
    return true
  }
  async session() {
    const path = `/api/genflowpro/common/userreport?${WEB_QUERY}`
    let v = await this.request(path)
    if (Number(v.errno) === -6 && this.cookies.PTOKEN && await this.exchangeStoken()) v = await this.request(path)
    const d = assertOK(v, "库库会话校验")
    if (!d?.bdstoken || d.uk == null || String(d.uk) === "0" || String(d.uk) === "") throw new KukuError("库库未返回账号标识或会话令牌，请进入官网工作台后重试")
    return { bdstoken: String(d.bdstoken), uinfo: String(d.uinfo ?? ""), uk: String(d.uk),
      name: String(d.uname ?? d.username ?? d.display_name ?? d.uk) }
  }
  async models(session) {
    const v = await this.request(`/wenchain/genflowpro/model/list?${WEB_QUERY}&${new URLSearchParams(session)}`)
    const data = assertOK(v, "库库模型目录")
    return extractModels(data)
  }
  async balance() {
    const d = assertOK(await this.request("/bizapi/gfpro/getgfvipremain?channel=chunlei&clienttype=400&version=1.4.4"), "库库余额查询")
    const item = d?.list?.find(x => x.assetName === "token")
    const balance = numberOrNull(item?.totalPoint)
    if (balance === null) throw new KukuError("库库未返回积分余额，不能将未知余额显示为零")
    return { balance, name: d.uname }
  }
}
export function extractModels(data) {
  const ids = new Map()
  function walk(v) {
    if (!v || typeof v !== "object") return
    if (Array.isArray(v)) { v.forEach(walk); return }
    const id = v.model_name ?? v.modelName ?? v.modelId
    if (typeof id === "string" && id.trim()) ids.set(id, {
      id, name: String(v.model_display_name ?? v.display_name ?? v.displayName ?? id),
    })
    Object.values(v).forEach(walk)
  }
  walk(data)
  return [...ids.values()]
}
