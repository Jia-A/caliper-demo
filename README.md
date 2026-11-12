# caliper-demo

A small streaming chat, built to be measured by [Caliper](https://github.com/Jia-A/caliper) and to show what it sees. Next.js App Router, plain JavaScript, no dependencies beyond Next.js, React and `caliper-timings`.

- `POST /api/chat`: checks the input and the rate limits, sends the conversation to the model, and streams the reply back as plain text. The same `messages` array goes to the model and to `caliper-timings`' `run.prompt()`, which records sizes only, never text. The system prompt's two parts (`persona`, `rules`) are named.
- `GET /__caliper/timings/:id`: Caliper's endpoint, from the folder `app/%5F_caliper/timings/[id]` (a `_` folder is private in the App Router; `%5F` is an encoded `_`). Without `CALIPER_TOKEN` it answers 404 like any unknown route.

## Limits (`lib/limits.js`)

| | |
|---|---|
| Per IP, per 10 minutes | 5 chat requests |
| Per IP, per UTC day | 20 |
| The whole demo, per UTC day | 300 |
| Conversation sent | at most 6 messages, 500 characters each, 16 KB in all |
| Model reply | at most 300 tokens (`max_tokens`) |

Counters live in Upstash Redis: one per window, `INCR` and `EXPIRE` in one `/multi-exec` transaction (6 commands per chat request). Over a limit: `429` with `Retry-After`, and no model call. If Upstash can't be reached, requests are refused (`503`), never let through. Without Upstash env vars (local runs), counters are kept in memory. The client IP is `x-real-ip`, else the first `x-forwarded-for` entry. A Caliper audit with `--runs 2 --server-runs 1` uses 3 chat requests.

The model key is only read on the server (`MODEL_API_KEY`, never a `NEXT_PUBLIC_` variable), sent only to the model as a bearer token, and never in a response: a model error answers `502` with a fixed message.

## Environment variables

| Name | |
|---|---|
| `MODEL_PROVIDER` | `fake` (a fixed streamed reply, no key) or `openai-compatible` |
| `MODEL_BASE_URL` | Gemini: `https://generativelanguage.googleapis.com/v1beta/openai` · Groq: `https://api.groq.com/openai/v1` |
| `MODEL_NAME` | the model, as the provider names it |
| `MODEL_API_KEY` | the provider's key (server only) |
| `CALIPER_TOKEN` | turns on Caliper's server timings; any long random string, the same one Caliper is run with |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | set by Vercel's Upstash integration (or `UPSTASH_REDIS_REST_URL` / `_TOKEN`) |

## Run locally

```sh
npm install
MODEL_PROVIDER=fake CALIPER_TOKEN=local-demo-token npm run build && npm start
```

Then measure it from Caliper's repo (`packages/cli`):

```sh
CALIPER_TOKEN=local-demo-token node dist/cli.js audit http://localhost:3000/ \
  --input "#prompt" --prompt "What does Caliper measure?" --output "#reply" \
  --runs 2 --server-timings http://localhost:3000 --server-runs 1
```

## Tests

`npm test` runs `lib/chat.js` (the route's core, framework-free) against a fake OpenAI-style model server and a fake Upstash REST server on 127.0.0.1, with no external calls:

- the reply streams as plain text;
- the key goes only to the model, as a bearer;
- the very same messages array goes to the model and to `run.prompt`, with the system prompt's parts;
- a marked request's record has the marks, sizes and parts and no text;
- bad input is refused (400) with no model call;
- the 10-minute and daily limits work, per IP and for the whole demo;
- Upstash down refuses the request (503);
- a model error answers 502 without its message or the key;
- the fake model works without a key;
- memory limits apply without Upstash.

Each guard was checked by breaking it: a copy of the messages going to the model, limits failing open, no limit check, client system messages allowed.

Checked by hand once, on 2026-11-13, with Next.js 16.2.6 locally and the fake model: `next build` lists `/__caliper/timings/[id]`, and the Caliper audit above timed both runs and showed the marked visit's spans, the prompt sizes and the two parts. Not yet on Vercel, with real Upstash, or with a real model.
