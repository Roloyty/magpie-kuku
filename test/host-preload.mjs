// Used only by scripts/host-smoke.mjs. Synthetic accounts, no live traffic.
globalThis.fetch = async (input, init = {}) => {
  const url = String(input)
  if (!url.startsWith("https://kuku.baidu.com/")) throw new Error("offline host smoke test refuses external traffic")
  const cookie = new Headers(init.headers).get("Cookie") ?? ""
  const who = cookie.includes("synthetic-B") ? "B" : "A"
  if (url.includes("userreport")) return Response.json({ errno: 0, data: { bdstoken: "token-" + who, uk: "uid-" + who, uname: "test-" + who } })
  if (url.includes("model/list")) return Response.json({ status: { code: 0 }, data: { model_list: [{ model_name: "model-" + who }] } })
  if (url.includes("getgfvipremain")) return Response.json({ status: { code: 0 }, data: { uname: "test-" + who, list: [{ assetName: "token", totalPoint: who === "A" ? "100" : "200" }] } })
  if (url.includes("conf?")) return Response.json({ errno: 0, data: [{ conf_value: { activityTid: "test", signPoint: 10 } }] })
  if (url.includes("homepage")) return Response.json({ errno: 0, data: { signed_today: who === "A", continuous_days: 1 } })
  if (url.includes("getJsToken")) return Response.json({ data: { jsToken: 'fn("SYNTHETIC")' } })
  if (url.includes("signin?")) return Response.json({ errno: 0, data: { signed_today: true, continuous: 2 } })
  throw new Error("unmocked Kuku path")
}
