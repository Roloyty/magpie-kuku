// SPDX-License-Identifier: AGPL-3.0-only
// Protocol adapted from ProvidersPlugin/Agent2Providers (AGPL-3.0).
import { randomUUID, randomBytes } from "node:crypto"
import { WEB_QUERY, assertOK, KukuError } from "./api.mjs"
export function buildPrompt(body) {
  if (body.tools?.length && body.tool_choice !== "none") throw new KukuError("库库插件目前支持文本对话，尚不支持原生工具调用", 400)
  if (!Array.isArray(body.messages) || !body.messages.length) throw new KukuError("messages 不能为空", 400)
  return body.messages.map(m => {
    if (m.role === "tool" || m.tool_calls?.length) throw new KukuError("库库插件尚不支持工具消息", 400)
    let content = m.content
    if (Array.isArray(content)) {
      if (content.some(p => p.type !== "text")) throw new KukuError("库库插件目前仅支持文本输入", 400)
      content = content.map(p => p.text ?? "").join("\n")
    }
    if (typeof content !== "string") throw new KukuError("消息内容必须是文本", 400)
    const label = { system: "系统指令", developer: "开发者指令", assistant: "助手之前的回复", user: "用户" }[m.role]
    if (!label) throw new KukuError("不支持的消息角色", 400)
    return `[${label}] ${content}`
  }).join("\n\n")
}
function payload(prompt, model) {
  return { project_type: 1, text: prompt,
    rich_input_params: [{ id: "textId", version: "1.0", type: "text", text: prompt, data: { content: prompt } }],
    fsid: [], quotes: [], skills: [], experts: [], model_name: model, model_display_name: model, think_mode: 3,
    show_text: JSON.stringify({ skills: [], experts: [], model_name: model, model_display_name: model, think_mode: 3,
      richInputContent: [{ type: "text", text: prompt }], fileInfo: [] }), premake_data: {}, custom_instructions: "",
    memory_sign: true, skill_dig_sign: true }
}
// SSE framing handles CRLF, multi-line data, UTF-8 split across arbitrary chunks,
// terminal errors, cancellation, and truncated streams without a false success.
export async function* events(body) {
  if (!body) throw new KukuError("库库没有返回对话内容")
  const reader = body.getReader(), decoder = new TextDecoder()
  let buffer = "", data = [], dataSize = 0, ended = false
  const parse = () => {
    const raw = data.join("\n"); data = []; dataSize = 0
    if (!raw) return null
    if (raw === "[DONE]") return { type: "DIALOGUE_END" }
    try { return JSON.parse(raw) } catch { throw new KukuError("库库对话事件格式异常") }
  }
  try {
    while (true) {
      const { value, done } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      if (buffer.length > 8 * 1024 * 1024) throw new KukuError("库库对话事件超过大小限制")
      if (done && buffer && !buffer.endsWith("\n")) buffer += "\n"
      let nl
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).replace(/\r$/, ""); buffer = buffer.slice(nl + 1)
        if (line.startsWith("data:")) {
          dataSize += line.length
          if (dataSize > 8 * 1024 * 1024) throw new KukuError("库库对话事件超过大小限制")
          data.push(line.slice(5).replace(/^ /, ""))
        }
        else if (line === "") { const v = parse(); if (v) { yield v; if (["DIALOGUE_END", "REPLY_END", "ERROR"].includes(v.type)) { ended = true; return } } }
      }
      if (done) {
        const v = parse()
        if (v) { yield v; ended = ["DIALOGUE_END", "REPLY_END", "ERROR"].includes(v.type) }
        if (!ended) throw new KukuError("库库对话流意外中断，未收到完成标记")
        return
      }
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}
async function openChat(client, body) {
  const prompt = buildPrompt(body), model = String(body.model ?? "auto")
  const session = await client.session()
  const query = `${WEB_QUERY}&${new URLSearchParams({ bdstoken: session.bdstoken, uinfo: session.uinfo, uk: session.uk })}`
  const csi = randomUUID(), data = payload(prompt, model)
  data.client_added = JSON.stringify({ client_session_id: csi, permission_type: 0, clienttype: 400, app_id: 123971023,
    web: 1, channel: "chunlei", version: "1.4.4", bdstoken: session.bdstoken, uinfo: session.uinfo, uk: session.uk })
  const created = assertOK(await client.request(`/wenchain/genflowpro/sendmsg?${query}`, { method: "POST", timeout: 60000,
    json: { type: "message", sub_type: "chat_create", client_session_id: csi, session_id: "", uk: "", cid: 0,
      channel: "kuku_web_genflowpro_v1", device_type: 400, created_at: Date.now(), msg_type: 1, sync_type: 0, sync_id: "", v: randomBytes(12).toString("hex"), data } }), "库库创建对话")
  if (!created?.session_id || !created?.reply_id) throw new KukuError("库库未返回对话标识")
  for (const [path, json] of [
    ["/wenchain/genflow/idallochstr", { channel: "kuku_web_genflowpro_v1", gen_type: 2 }],
    ["/api/genflowpro/workspace/sessionswitch", { session_id: created.session_id, op: 1, full_access_enabled: 0 }],
  ]) { try { await client.request(`${path}?${query}`, { method: "POST", json, timeout: 15000 }) } catch (e) { if (client.signal?.aborted) throw e } }
  return client.request(`/wenchain/genflowpro/sse/getchatcontent?${query}`, { method: "POST", stream: true, timeout: 300000,
    json: { ...payload(prompt, model), session_id: created.session_id, reply_id: created.reply_id } })
}
export async function chatResponse(client, body) {
  const cancellation = new AbortController()
  client.signal = AbortSignal.any([...(client.signal ? [client.signal] : []), cancellation.signal])
  const res = await openChat(client, body)
  const id = `chatcmpl-${randomUUID()}`, model = String(body.model ?? "auto"), created = Math.floor(Date.now() / 1000)
  const chunk = (delta, finish_reason = null) => ({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta, finish_reason }] })
  const iterator = events(res.body)
  if (!body.stream) {
    let text = ""
    for await (const e of iterator) {
      if (e.type === "ERROR") throw new KukuError("库库上游返回对话错误")
      if (e.type === "TEXT_BLOCK_DELTA" && typeof e.data?.delta === "string") text += e.data.delta
    }
    if (!text) throw new KukuError("库库未返回文本回复")
    return Response.json({ id, object: "chat.completion", created, model, choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }] })
  }
  const encoder = new TextEncoder()
  let started = false, finished = false, sawText = false
  const wire = v => encoder.encode(`data: ${typeof v === "string" ? v : JSON.stringify(v)}\n\n`)
  return new Response(new ReadableStream({
    async pull(controller) {
      if (finished) return
      if (!started) { started = true; controller.enqueue(wire(chunk({ role: "assistant" }))); return }
      try {
        while (true) {
          const { value: e, done } = await iterator.next()
          if (done || ["REPLY_END", "DIALOGUE_END"].includes(e?.type)) {
            if (!sawText) throw new KukuError("库库未返回文本回复")
            finished = true; await iterator.return(); controller.enqueue(wire(chunk({}, "stop"))); controller.enqueue(wire("[DONE]")); controller.close(); return
          }
          if (e.type === "ERROR") throw new KukuError("库库上游返回对话错误")
          if (e.type === "TEXT_BLOCK_DELTA" && typeof e.data?.delta === "string" && e.data.delta) { sawText = true; controller.enqueue(wire(chunk({ content: e.data.delta }))); return }
        }
      } catch {
        finished = true; await iterator.return().catch(() => {})
        controller.enqueue(wire({ error: { type: "upstream_error", message: "库库对话流失败或中断，请重试" } })); controller.enqueue(wire("[DONE]")); controller.close()
      }
    },
    async cancel() { finished = true; cancellation.abort(); await iterator.return() },
  }), { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache" } })
}
