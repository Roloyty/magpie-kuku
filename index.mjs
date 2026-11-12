// SPDX-License-Identifier: AGPL-3.0-only
import { KukuClient, ORIGIN, safeMessage } from "./lib/api.mjs"
import { browserSignIn } from "./lib/browser.mjs"
import { checkin } from "./lib/checkin.mjs"
import { chatResponse } from "./lib/chat.mjs"

const ID = "kuku", NAME = "百度库库 AI"
const configModel = (name) => ({ name, tool_call: false, attachment: false, modalities: { input: ["text"], output: ["text"] } })
const fallback = () => ({ auto: configModel("库库自动选择（目录未刷新）") })
const runtimeModel = (p, m) => ({ id: m.id, name: m.name, providerID: p.id ?? ID,
  api: { id: m.id, url: `${ORIGIN}/v1`, npm: "@ai-sdk/openai-compatible" },
  capabilities: { temperature: false, reasoning: false, attachment: false, toolcall: false,
    input: { text: true, audio: false, image: false, video: false, pdf: false }, output: { text: true, audio: false, image: false, video: false, pdf: false } },
  cost: { input: 0, output: 0, cache: { read: 0, write: 0 } }, limit: { context: 0, output: 0 },
  options: {}, headers: {}, status: "active", release_date: "", variants: {} })

async function verifiedAuth(cookies, { signal } = {}) {
  const c = new KukuClient({ cookies }, { signal })
  const session = await c.session()
  return { type: "success", access: JSON.stringify(c.cookies), refresh: "", expires: 0,
    accountId: session.uk, uid: session.uk, name: session.name, cardName: session.name, source: "kuku-web" }
}
export const KukuAuthPlugin = async () => ({
  async config(config) {
    config.provider ??= {}
    const was = config.provider[ID] ?? {}
    config.provider[ID] = { ...was, name: NAME, npm: "@ai-sdk/openai-compatible", api: `${ORIGIN}/v1`, models: { ...fallback(), ...(was.models ?? {}) } }
  },
  provider: {
    id: ID,
    async models(provider, { auth } = {}) {
      if (!auth?.access) return provider.models
      const c = new KukuClient(auth)
      const session = await c.session()
      const models = await c.models(session)
      if (!models.length) throw new Error("库库模型目录为空，请在官网确认账号可用模型")
      return Object.fromEntries(models.map(m => [m.id, runtimeModel(provider, m)]))
    },
  },
  auth: {
    provider: ID,
    methods: [
      { type: "oauth", label: "库库官网网页登录（Chrome / Edge）", authorize: async (_inputs, { signal } = {}) => browserSignIn(verifiedAuth, { signal }) },
      { type: "oauth", label: "手动导入库库 Cookie", authorize: async () => ({
        url: `${ORIGIN}/genflowpro`, method: "code", instructions: "在库库官网登录后粘贴 Cookie（BDUSS、STOKEN，可含 PTOKEN），或粘贴 Cookie 编辑器导出的 JSON。凭证只保存到本机 Magpie。",
        callback: async input => { try { return await verifiedAuth(input) } catch (e) { return { type: "failed", error: "库库 Cookie 校验失败，请检查登录态后重试" } } },
      }) },
    ],
    async loader(getAuth) {
      return { apiKey: "kuku-session", async fetch(input, init = {}) {
        let c
        try {
          const a = await getAuth()
          if (!a?.access) return Response.json({ error: { message: "请先登录库库账号" } }, { status: 401 })
          const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url)
          if (!url.pathname.endsWith("/chat/completions")) return Response.json({ error: { message: "库库插件仅提供文本 chat/completions" } }, { status: 400 })
          const text = init.body ?? (input instanceof Request ? await input.text() : "")
          const body = JSON.parse(typeof text === "string" ? text : new TextDecoder().decode(text))
          c = new KukuClient(a, { signal: init.signal ?? (input instanceof Request ? input.signal : undefined) })
          return await chatResponse(c, body)
        } catch (e) {
          return Response.json({ error: { message: safeMessage(e, c?.cookies), type: e.status === 401 ? "authentication_error" : "api_error" } }, { status: e.status ?? 502 })
        }
      } }
    },
    async usage(getAuth) {
      let c
      try {
        const a = await getAuth()
        if (!a?.access) return { error: "请先登录库库", signIn: "kept" }
        c = new KukuClient(a)
        const b = await c.balance()
        return { plan: NAME, user: b.name || a.name || a.accountId,
          windows: [{ name: "库库积分", used: 0, display: `${b.balance} 积分`, aside: true }] }
      } catch (e) { return { error: safeMessage(e, c?.cookies), signIn: e.signIn === "expired" ? "expired" : "kept" } }
    },
    async checkin(getAuth) {
      let c
      try { c = new KukuClient(await getAuth()); return await checkin(c) }
      catch (e) { return { outcome: "failed", message: safeMessage(e, c?.cookies) } }
    },
  },
})
