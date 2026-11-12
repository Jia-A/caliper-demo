// POST /api/chat, framework-free: a Request in, a Response out (the Next.js route only adds after()).
// Checks the input and the rate limits, builds the messages, and streams the model's reply. The
// same messages array goes to the model and to caliper-timings' run.prompt (sizes only, never text).
import { finish, start } from "caliper-timings/upstash";
import { LIMITS } from "./limits.js";
import { defaultModel, ModelError } from "./model.js";
import { checkLimits } from "./ratelimit.js";
import { timingStore } from "./store.js";

const PERSONA = "You are the assistant in Caliper's demo. Caliper measures how fast AI features feel in a real browser.";
const RULES = "Answer in at most three short sentences. Plain text only, no markdown. If asked for anything unrelated to Caliper or web performance, say briefly that this demo only covers that.";
const SYSTEM = [PERSONA, RULES].join("\n\n");

const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });

const clientIp = (request) => request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

// The conversation from the client: only user/assistant messages, the last one the user's.
function readMessages(body) {
  const list = body?.messages;
  if (!Array.isArray(list) || list.length === 0) return "Send { messages: [{ role, content }] }.";
  if (list.length > LIMITS.maxMessages) return `At most ${LIMITS.maxMessages} messages.`;
  for (const m of list) {
    if (m?.role !== "user" && m?.role !== "assistant") return "Each message's role must be user or assistant.";
    if (typeof m.content !== "string" || !m.content.trim()) return "Each message needs text.";
    if (m.content.length > LIMITS.maxMessageChars) return `Each message can be at most ${LIMITS.maxMessageChars} characters.`;
  }
  if (list.at(-1).role !== "user") return "The last message must be the user's.";
  return list.map(({ role, content }) => ({ role, content }));
}

export async function handleChat(request, { env, defer, model = defaultModel, store = timingStore(env), now = Date.now }) {
  const run = await start(request, { token: env.CALIPER_TOKEN, store, defer });
  const done = (response) => (run ? finish(run, response) : response);

  const raw = await request.text().catch(() => "");
  if (new TextEncoder().encode(raw).length > LIMITS.maxBodyBytes) return done(json(413, { error: "Request too large." }));
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return done(json(400, { error: "Send JSON." }));
  }
  const history = readMessages(body);
  if (typeof history === "string") return done(json(400, { error: history }));

  run?.mark("limitStart");
  let limit;
  try {
    // run is non-null only for x-caliper-run with the right x-caliper-token (caliper-timings'
    // constant-time check): a Caliper audit, which skips the per-IP limits but not the daily cap.
    limit = await checkLimits(clientIp(request), env, now(), { audited: run !== null });
  } catch (err) {
    console.error("rate limit check failed", err);
    return done(json(503, { error: "The demo can't check its limits right now. Try again later." }));
  }
  run?.mark("limitEnd");
  if (!limit.ok) {
    const error = limit.scope === "all" ? "The demo reached its daily limit. Try again tomorrow." : "Too many requests from you. Try again later.";
    return done(json(429, { error }, { "retry-after": String(limit.retryAfter) }));
  }

  const messages = [{ role: "system", content: SYSTEM }, ...history];
  const parts = [
    { message: 0, name: "persona", text: PERSONA },
    { message: 0, name: "rules", text: RULES },
  ];
  run?.prompt(messages, { parts });
  run?.mark("modelCallSent");
  let stream;
  try {
    stream = await model(env)(messages);
  } catch (err) {
    if (!(err instanceof ModelError)) console.error("model call failed", err);
    return done(json(502, { error: "The model didn't answer. Try again in a minute." }));
  }
  return done(new Response(run ? run.watchFirstChunk(stream) : stream, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } }));
}
