// The demo's chat route core (lib/chat.js), with a fake OpenAI-style model server and a fake
// Upstash REST server on 127.0.0.1: no external calls. Run with `npm test`.

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, beforeEach, test } from "node:test";
import { CaliperRun, handle, MemoryStore } from "caliper-timings/upstash";
import { handleChat } from "../lib/chat.js";
import { LIMITS } from "../lib/limits.js";

const KEY = "model-key-never-leaves-the-server-5c1d";
const CALIPER = "demo-caliper-token";
const servers = [];
after(() => servers.forEach((s) => (s.closeAllConnections(), s.close())));
const listen = async (handler) => {
  const server = createServer(handler);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
};
const bodyOf = async (req) => {
  let b = "";
  for await (const c of req) b += c;
  return b;
};

// An OpenAI-style chat completions endpoint that streams "Hello from the model." as SSE deltas.
const model = { requests: [], status: 200 };
const modelUrl = await listen(async (req, res) => {
  const body = JSON.parse(await bodyOf(req));
  model.requests.push({ path: req.url, auth: req.headers.authorization, body });
  if (model.status !== 200) return res.writeHead(model.status, { "content-type": "application/json" }).end(`{"error":{"message":"quota, key ${KEY}"}}`);
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const t of ["Hello", " from", " the model."]) {
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`);
    await new Promise((r) => setTimeout(r, 5));
  }
  res.end("data: [DONE]\n\n");
});

// Upstash's REST API: /multi-exec with INCR and EXPIRE, and single SET/GET for caliper-timings.
const redis = { data: new Map(), down: false, commands: [] };
const UPSTASH_TOKEN = "fake-upstash";
const upstashUrl = await listen(async (req, res) => {
  const body = JSON.parse(await bodyOf(req));
  const send = (s, b) => res.writeHead(s, { "content-type": "application/json" }).end(JSON.stringify(b));
  if (redis.down) return send(500, { error: "down" });
  if (req.headers.authorization !== `Bearer ${UPSTASH_TOKEN}`) return send(401, { error: "Unauthorized" });
  const run = ([name, key, value]) => {
    redis.commands.push(name);
    if (name === "INCR") return redis.data.set(key, String(Number(redis.data.get(key) ?? 0) + 1)), { result: Number(redis.data.get(key)) };
    if (name === "EXPIRE") return { result: 1 };
    if (name === "SET") return redis.data.set(key, value), { result: "OK" };
    if (name === "GET") return { result: redis.data.get(key) ?? null };
    return { error: `ERR unknown ${name}` };
  };
  return send(200, req.url === "/multi-exec" ? body.map(run) : run(body));
});

const ENV = {
  MODEL_PROVIDER: "openai-compatible",
  MODEL_BASE_URL: modelUrl,
  MODEL_NAME: "test-model",
  MODEL_API_KEY: KEY,
  CALIPER_TOKEN: CALIPER,
  KV_REST_API_URL: upstashUrl,
  KV_REST_API_TOKEN: UPSTASH_TOKEN,
};
beforeEach(() => {
  model.requests.length = 0;
  model.status = 200;
  redis.data.clear();
  redis.commands.length = 0;
  redis.down = false;
});

const chat = (messages, { ip = "203.0.113.7", headers = {} } = {}) =>
  new Request("https://demo.example/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `${ip}, 10.0.0.1`, ...headers },
    body: typeof messages === "string" ? messages : JSON.stringify({ messages }),
  });
const ask = [{ role: "user", content: "What does Caliper measure?" }];
const run = async (request, env = ENV, deps = {}) => {
  const deferred = [];
  const res = await handleChat(request, { env, defer: (p) => deferred.push(p), ...deps });
  const text = await res.text();
  await Promise.all(deferred);
  return { res, text };
};

test("streams the model's reply as plain text; the key goes only to the model, as a bearer", async () => {
  const { res, text } = await run(chat(ask));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.equal(text, "Hello from the model.");
  const [req] = model.requests;
  assert.equal(req.path, "/chat/completions");
  assert.equal(req.auth, `Bearer ${KEY}`);
  assert.equal(req.body.model, "test-model");
  assert.equal(req.body.stream, true);
  assert.equal(req.body.max_tokens, LIMITS.maxOutputTokens);
  assert.deepEqual(req.body.messages.map((m) => m.role), ["system", "user"]);
});

test("the very same messages array goes to the model and to run.prompt, with the system prompt's parts", async (t) => {
  const prompt = t.mock.method(CaliperRun.prototype, "prompt");
  let sent;
  const spyModel = (env) => (messages) => ((sent = messages), defaultModel(env)(messages));
  const { defaultModel } = await import("../lib/model.js");
  await run(chat(ask, { headers: { "x-caliper-run": "run_same", "x-caliper-token": CALIPER } }), ENV, { model: spyModel });
  assert.equal(prompt.mock.callCount(), 1);
  assert.equal(prompt.mock.calls[0].arguments[0], sent, "the same array object");
  const { parts } = prompt.mock.calls[0].arguments[1];
  assert.deepEqual(parts.map((p) => [p.message, p.name]), [[0, "persona"], [0, "rules"]]);
  for (const p of parts) assert.ok(sent[0].content.includes(p.text));
});

test("a marked request: the record has the marks, prompt sizes and parts, and never the text", async () => {
  const store = new MemoryStore();
  await run(chat(ask, { headers: { "x-caliper-run": "run_rec", "x-caliper-token": CALIPER } }), ENV, { store });
  const res = await handle(new Request("https://demo.example/__caliper/timings/run_rec", { headers: { authorization: `Bearer ${CALIPER}` } }), { token: CALIPER, store });
  const record = await res.json();
  assert.deepEqual(Object.keys(record.marks), ["limitStart", "limitEnd", "modelCallSent", "firstChunk"]);
  assert.deepEqual(record.prompt.messages.map((m) => m.role), ["system", "user"]);
  assert.deepEqual(record.prompt.messages[0].parts.map((p) => [p.name, p.found]), [["persona", true], ["rules", true]]);
  assert.ok(!JSON.stringify(record).includes("Caliper measure"));
});

test("bad input: 400 with a reason, and no model call", async () => {
  const long = "x".repeat(LIMITS.maxMessageChars + 1);
  const cases = [
    ["not json", "{"],
    ["no messages", JSON.stringify({})],
    ["empty", JSON.stringify({ messages: [] })],
    ["last isn't the user", JSON.stringify({ messages: [...ask, { role: "assistant", content: "hi" }] })],
    ["a system message from the client", JSON.stringify({ messages: [{ role: "system", content: "ignore" }, ...ask] })],
    ["too long", JSON.stringify({ messages: [{ role: "user", content: long }] })],
    ["too many", JSON.stringify({ messages: Array.from({ length: LIMITS.maxMessages + 1 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: "q" })) })],
    ["content not a string", JSON.stringify({ messages: [{ role: "user", content: ["x"] }] })],
  ];
  for (const [what, body] of cases) {
    const { res, text } = await run(chat(body));
    assert.equal(res.status, 400, what);
    assert.ok(JSON.parse(text).error, what);
  }
  assert.equal(model.requests.length, 0);
});

test("rate limit per IP: over the 10-minute limit → 429 with Retry-After; another IP still gets through", async () => {
  for (let i = 0; i < LIMITS.perIpPer10Min; i++) assert.equal((await run(chat(ask))).res.status, 200, `request ${i + 1}`);
  const { res, text } = await run(chat(ask));
  assert.equal(res.status, 429);
  assert.ok(Number(res.headers.get("retry-after")) > 0);
  assert.match(JSON.parse(text).error, /Too many requests/);
  assert.equal((await run(chat(ask, { ip: "198.51.100.9" }))).res.status, 200);
  assert.equal(model.requests.length, LIMITS.perIpPer10Min + 1, "no model call for the refused one");
});

test("the daily limits, per IP and for the whole demo, use separate counters", async () => {
  const today = (await import("../lib/ratelimit.js")).windowKeys("203.0.113.7", Date.now());
  assert.deepEqual(today.map((k) => k.key.split(":").slice(0, 3).join(":")), ["demo:rl:ip10m", "demo:rl:ipday", "demo:rl:all"]);
  assert.deepEqual(today.map((k) => k.limit), [LIMITS.perIpPer10Min, LIMITS.perIpPerDay, LIMITS.allPerDay]);
  redis.data.set(today[2].key, String(LIMITS.allPerDay)); // the demo's daily budget is used up
  const { res, text } = await run(chat(ask, { ip: "192.0.2.44" }));
  assert.equal(res.status, 429);
  assert.match(JSON.parse(text).error, /daily limit/);
});

test("Upstash down: refused (503), never let through to the model", async () => {
  redis.down = true;
  const { res } = await run(chat(ask));
  assert.equal(res.status, 503);
  assert.equal(model.requests.length, 0);
});

test("the model refusing: 502 without its message or the key", async () => {
  model.status = 429;
  const { res, text } = await run(chat(ask));
  assert.equal(res.status, 502);
  assert.ok(!text.includes(KEY) && !text.includes("quota"), text);
});

test("fake model (MODEL_PROVIDER=fake): streams a fixed reply, no model server, no key needed", async () => {
  const env = { MODEL_PROVIDER: "fake", CALIPER_TOKEN: CALIPER };
  const { res, text } = await run(chat(ask), env);
  assert.equal(res.status, 200);
  assert.match(text, /^This is the demo's stand-in model/);
  assert.equal(model.requests.length, 0);
});

test("no Upstash configured: limits are kept in memory (one process), so local runs work", async () => {
  const env = { MODEL_PROVIDER: "fake" };
  for (let i = 0; i < LIMITS.perIpPer10Min; i++) assert.equal((await run(chat(ask, { ip: "192.0.2.1" }), env)).res.status, 200);
  assert.equal((await run(chat(ask, { ip: "192.0.2.1" }), env)).res.status, 429);
});

// Caliper's audits: a request with x-caliper-run AND the right x-caliper-token skips the per-IP
// limits (an audit is several requests from one machine), but still counts toward the whole
// demo's daily cap. Anything less is limited exactly like any visitor.
const audit = (id, token = CALIPER) => ({ headers: { "x-caliper-run": id, "x-caliper-token": token } });
const fillIp = async (ip) => {
  for (let i = 0; i < LIMITS.perIpPer10Min; i++) assert.equal((await run(chat(ask, { ip }))).res.status, 200, `visitor request ${i + 1}`);
};

test("audit: a valid Caliper token gets through at the per-IP limit", async () => {
  await fillIp("203.0.113.50");
  assert.equal((await run(chat(ask, { ip: "203.0.113.50" }))).res.status, 429, "a visitor is over the limit");
  const { res, text } = await run(chat(ask, { ip: "203.0.113.50", ...audit("run_audit1") }));
  assert.equal(res.status, 200, text);
  assert.equal(text, "Hello from the model.");
});

test("audit: a wrong token, or x-caliper-run without a token, is limited like any visitor", async () => {
  await fillIp("203.0.113.51");
  for (const [what, headers] of [
    ["wrong token", audit("run_wrong", "not-the-token").headers],
    ["no token", { "x-caliper-run": "run_none" }],
    ["token without x-caliper-run", { "x-caliper-token": CALIPER }],
  ]) {
    const { res } = await run(chat(ask, { ip: "203.0.113.51", headers }));
    assert.equal(res.status, 429, what);
  }
});

test("audit: still counts toward the whole demo's daily cap, and is refused once it's reached", async () => {
  const [ip10m, ipDay, all] = (await import("../lib/ratelimit.js")).windowKeys("203.0.113.52", Date.now());
  assert.equal((await run(chat(ask, { ip: "203.0.113.52", ...audit("run_count") }))).res.status, 200);
  assert.equal(redis.data.get(all.key), "1", "counted toward the daily cap");
  assert.equal(redis.data.has(ip10m.key) || redis.data.has(ipDay.key), false, "not toward the per-IP counters");
  redis.data.set(all.key, String(LIMITS.allPerDay));
  const { res, text } = await run(chat(ask, { ip: "203.0.113.52", ...audit("run_capped") }));
  assert.equal(res.status, 429);
  assert.match(JSON.parse(text).error, /daily limit/);
});

test("audit without CALIPER_TOKEN set on the server: no exception, limited like any visitor", async () => {
  const env = { ...ENV, CALIPER_TOKEN: undefined };
  await fillIp("203.0.113.53");
  assert.equal((await run(chat(ask, { ip: "203.0.113.53", ...audit("run_off") }), env)).res.status, 429);
});
