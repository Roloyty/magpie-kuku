import test from "node:test"
import assert from "node:assert/strict"
import { events, buildPrompt, chatResponse } from "../lib/chat.mjs"
const encoder = new TextEncoder()
const frame = (type, data) => `data: ${JSON.stringify({ type, data })}\r\n\r\n`
function stream(text, step = 1) {
  const bytes = encoder.encode(text); let offset = 0
  return new ReadableStream({ pull(c) { if (offset >= bytes.length) return c.close(); c.enqueue(bytes.slice(offset, offset += step)) } })
}
function clientFor(text) {
  return { signal: undefined, calls: [], session: async () => ({ bdstoken: "t", uinfo: "i", uk: "1" }),
    async request(path, init) { this.calls.push({ path, init });
      if (path.includes("sendmsg")) return { status: { code: 0 }, data: { session_id: "s", reply_id: "r" } }
      if (init.stream) return new Response(stream(text), { headers: { "Content-Type": "text/event-stream" } })
      return { errno: 0 }
    } }
}
test("SSE parser preserves Chinese UTF-8 and CRLF split at every byte", async () => {
  const result = []
  for await (const e of events(stream(frame("TEXT_BLOCK_DELTA", { delta: "你好🌍" }) + frame("REPLY_END", {})))) result.push(e)
  assert.equal(result[0].data.delta, "你好🌍"); assert.equal(result[1].type, "REPLY_END")
})
test("missing completion marker fails rather than producing successful partial text", async () => {
  await assert.rejects(async () => { for await (const e of events(stream(frame("TEXT_BLOCK_DELTA", { delta: "partial" })))) {} }, /意外中断/)
})
test("multiline data and terminal frame without blank newline", async () => {
  const s = 'data: {"type":\n' + 'data: "REPLY_END"}\n'
  const result = []; for await (const e of events(stream(s))) result.push(e)
  assert.equal(result[0].type, "REPLY_END")
})
test("unsupported tools and image parts fail explicitly", () => {
  assert.throws(() => buildPrompt({ tools: [{}], messages: [{ role: "user", content: "hi" }] }), /工具/)
  assert.throws(() => buildPrompt({ messages: [{ role: "user", content: [{ type: "image_url" }] }] }), /文本/)
  assert.match(buildPrompt({ messages: [{ role: "system", content: "instruction" }, { role: "user", content: "hi" }] }), /系统指令/)
})
test("full nonstream conversation forwards selected model and returns real text", async () => {
  const c = clientFor(frame("TEXT_BLOCK_DELTA", { delta: "你好" }) + frame("DIALOGUE_END", {}))
  const res = await chatResponse(c, { model: "selected", messages: [{ role: "user", content: "Hi" }] })
  assert.equal((await res.json()).choices[0].message.content, "你好")
  assert.equal(c.calls[0].init.json.data.model_name, "selected"); assert.equal(c.calls.at(-1).init.json.session_id, "s")
})
test("streaming completion carries stop only after real text and an end marker", async () => {
  const c = clientFor(frame("TEXT_BLOCK_DELTA", { delta: "yes" }) + frame("REPLY_END", {}))
  const res = await chatResponse(c, { stream: true, messages: [{ role: "user", content: "Hi" }] })
  const text = await res.text(); assert.match(text, /"content":"yes"/); assert.match(text, /"finish_reason":"stop"/); assert.match(text, /\[DONE\]/)
})
test("streaming errors, empty replies and truncation never emit stop", async () => {
  for (const text of [frame("ERROR", { message: "secret upstream body" }), frame("REPLY_END", {}), frame("TEXT_BLOCK_DELTA", { delta: "partial" })]) {
    const res = await chatResponse(clientFor(text), { stream: true, messages: [{ role: "user", content: "Hi" }] })
    const out = await res.text(); assert.match(out, /upstream_error/); assert.doesNotMatch(out, /"finish_reason":"stop"|secret upstream body/)
  }
})
test("canceling the consumer aborts upstream fetch signal", async () => {
  const c = clientFor(frame("TEXT_BLOCK_DELTA", { delta: "hi" }) + frame("REPLY_END", {}))
  const res = await chatResponse(c, { stream: true, messages: [{ role: "user", content: "Hi" }] })
  await res.body.cancel(); assert.equal(c.signal.aborted, true)
})
