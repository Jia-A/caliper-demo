// The model: an OpenAI-style chat completions endpoint (Gemini's or Groq's), streamed, or a fake
// one for tests and local runs (MODEL_PROVIDER=fake). Either way: messages in, a stream of text out.
import { LIMITS } from "./limits.js";

export class ModelError extends Error {}

const FAKE_REPLY = "This is the demo's stand-in model. Caliper timed this reply from your click to the first word, and the server noted how big each part of the prompt was.".split(/(?<= )/);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const encoder = new TextEncoder();

function fakeModel() {
  return async () =>
    new ReadableStream({
      async start(controller) {
        await sleep(300);
        for (const word of FAKE_REPLY) {
          controller.enqueue(encoder.encode(word));
          await sleep(40);
        }
        controller.close();
      },
    });
}

// POST {base}/chat/completions with stream: true; the SSE deltas come back as plain text.
function openaiCompatible(env) {
  return async (messages) => {
    let res;
    try {
      res = await fetch(`${env.MODEL_BASE_URL.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers: { authorization: `Bearer ${env.MODEL_API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ model: env.MODEL_NAME, messages, stream: true, max_tokens: LIMITS.maxOutputTokens }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new ModelError("no answer");
    }
    if (!res.ok || !res.body) throw new ModelError(String(res.status));
    let buffer = "";
    return res.body.pipeThrough(new TextDecoderStream()).pipeThrough(
      new TransformStream({
        transform(chunk, controller) {
          buffer += chunk;
          const lines = buffer.split("\n");
          buffer = lines.pop();
          for (const line of lines) {
            const data = line.startsWith("data:") ? line.slice(5).trim() : "";
            if (!data || data === "[DONE]") continue;
            let text = "";
            try {
              text = JSON.parse(data).choices?.[0]?.delta?.content ?? "";
            } catch {
              // not a JSON event: skip it
            }
            if (text) controller.enqueue(encoder.encode(text));
          }
        },
      })
    );
  };
}

export const defaultModel = (env) => (env.MODEL_PROVIDER === "fake" ? fakeModel() : openaiCompatible(env));
