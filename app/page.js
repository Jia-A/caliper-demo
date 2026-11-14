// The landing page: static, no client JS. Every command and code block is quoted from the caliper-ai
// and caliper-timings READMEs (github.com/Jia-A/caliper); change them there first, then here.

const css = `
.l main { max-width: 760px; margin: 0 auto; padding: 40px 16px 64px; line-height: 1.55; }
.l h1 { font-size: 40px; margin: 0 0 8px; }
.l h2 { font-size: 22px; margin: 48px 0 12px; }
.l h3 { font-size: 17px; margin: 24px 0 8px; }
.l .lead { font-size: 20px; margin: 0 0 8px; }
.l .sub { color: #444; margin: 0; }
.l .muted { color: #555; }
.l pre { background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 12px; overflow-x: auto; font-size: 14px; line-height: 1.45; }
.l code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.l p code, .l li code { background: #eeede8; padding: 1px 4px; border-radius: 4px; font-size: 0.92em; }
.l figure { margin: 0 0 28px; }
.l figure img { display: block; width: 100%; height: auto; border: 1px solid #ddd; border-radius: 8px; background: #fff; }
.l figcaption { margin-top: 6px; color: #444; }
.l a { color: #0b57d0; }
.l .cta { display: flex; flex-wrap: wrap; gap: 12px; margin: 12px 0; }
.l .cta a { display: inline-block; padding: 10px 16px; border: 1px solid #0b57d0; border-radius: 8px; text-decoration: none; }
.l .cta a.primary { background: #0b57d0; color: #fff; }
.l ul { padding-left: 20px; }
.l li { margin: 6px 0; }
`;

const shots = [
  {
    src: "/shots/request-map.png",
    alt: "The Request Map from a Quill report: each part of the prompt with its size in bytes and a coloured square for who wrote it",
    caption: "Request Map: what's inside each AI request, in bytes, and who wrote each part (blue app, yellow user, red outside, grey unknown). Sizes only; the text is never recorded.",
  },
  {
    src: "/shots/advice.png",
    alt: "The Advice section of a Quill report",
    caption: "Advice: next steps that fire only from a number the run measured, each with its basis.",
  },
  {
    src: "/shots/timeline.png",
    alt: "A run's timeline from a Quill report, split into segments from the click to the first word",
    caption: "Timeline: each run from click to first word, split into segments. Run 1 is the cold one, in a fresh browser.",
  },
];

export default function Landing() {
  return (
    <div className="l">
      <style>{css}</style>
      <main>
        <h1>Caliper</h1>
        <p className="lead">Measures what your AI interface makes users wait for.</p>
        <p className="sub">
          It clicks through your AI feature like a real user, times how long it takes for the first word to appear on screen, and
          breaks that wait down step by step, so you can see exactly where the time goes.
        </p>

        <h2>What you get</h2>
        <p className="muted">From a real report: Quill, a blogging app with a &ldquo;generate a social post&rdquo; button, measured on Nov 14, 2026 (2 runs, 1 marked visit).</p>
        {shots.map((s) => (
          <figure key={s.src}>
            <img src={s.src} alt={s.alt} loading="lazy" />
            <figcaption>{s.caption}</figcaption>
          </figure>
        ))}

        <h2>Try it</h2>
        <div className="cta">
          <a className="primary" href="/demo">Chat with the demo</a>
          <a href="/report/quill.html">Open a full report (Quill)</a>
        </div>
        <p className="muted">
          In the Quill report, the backend&apos;s address is masked as <code>quill-backend.example</code>. Everything else is as
          Caliper wrote it.
        </p>
        <p>
          You can time the browser half on any site, this demo included. The server half (the Request Map, who wrote each part,
          the server&apos;s own timings) needs <code>caliper-timings</code> in the app and the app owner&apos;s{" "}
          <code>CALIPER_TOKEN</code>.
        </p>
        <pre><code>{`caliper audit https://caliper-audit.vercel.app/demo --input "#prompt" \\
  --prompt "What does Caliper measure?" --output "#reply" --runs 2`}</code></pre>
        <p className="muted">The demo runs on a free model tier with a small limit per visitor. Don&apos;t type anything private.</p>

        <h2>Use it on your own app</h2>
        <h3>1. Browser half: on your machine</h3>
        <p>The machine you run Caliper from (your laptop, or CI). Requires Node.js 20 or newer.</p>
        <pre><code>{`npm install -g caliper-ai
npx playwright@1.64.1 install chromium`}</code></pre>
        <p>
          Keep the <code>@1.64.1</code>: outside a project, a bare <code>npx playwright</code> fetches the latest Playwright,
          which downloads a different Chromium build that Caliper can&apos;t use. Then audit a chat-style page:
        </p>
        <pre><code>{`caliper audit https://your-app.example.com/chat --input "#msg" --prompt "hello" --output "#messages"`}</code></pre>
        <p>
          If the page needs a login, save a session first with <code>caliper login https://your-app.example.com</code> and pass{" "}
          <code>--auth auth.json</code>. Every audit that finishes writes <code>caliper-report.html</code> in the current
          directory.
        </p>

        <h3>2. Server half: in your app (optional)</h3>
        <p>Install it in the project of the app Caliper measures, not on the machine that runs Caliper:</p>
        <pre><code>npm install caliper-timings</code></pre>
        <p>
          It&apos;s off unless <code>CALIPER_TOKEN</code> is set. Set the same long random string in your app&apos;s environment
          and on your laptop. For Next.js App Router on Vercel, two route files share an Upstash Redis store:
        </p>
        <pre><code>{`// app/api/generate/route.js
import { after } from "next/server";
import { finish, MemoryStore, start, UpstashStore } from "caliper-timings/upstash";

const store = UpstashStore.fromEnv(process.env) ?? new MemoryStore();

export async function POST(request) {
  const run = await start(request, { token: process.env.CALIPER_TOKEN, store, defer: (p) => after(() => p) });
  // … run?.mark(…), run?.prompt(messages, { parts }), then the model's stream:
  const response = new Response(run ? run.watchFirstChunk(stream) : stream);
  return run ? finish(run, response) : response;
}`}</code></pre>
        <pre><code>{`// app/%5F_caliper/timings/[id]/route.js
import { handle, MemoryStore, UpstashStore } from "caliper-timings/upstash";

const store = UpstashStore.fromEnv(process.env) ?? new MemoryStore();

export async function GET(request) {
  return (await handle(request, { token: process.env.CALIPER_TOKEN, store })) ?? new Response("Not found", { status: 404 });
}`}</code></pre>
        <p>
          The store reads <code>UPSTASH_REDIS_REST_URL</code> / <code>_TOKEN</code>, or the <code>KV_REST_API_URL</code> /{" "}
          <code>_TOKEN</code> names Vercel&apos;s integration sets. The folder is <code>%5F_caliper</code>: a folder starting
          with <code>_</code> is private in the App Router, and <code>%5F</code> makes the URL <code>__caliper</code>. Plain
          Node, other fetch-based runtimes and Cloudflare Workers are in the{" "}
          <a href="https://github.com/Jia-A/caliper/tree/main/packages/timings#readme">caliper-timings README</a>.
        </p>
        <p>Then, on your laptop, with the same token:</p>
        <pre><code>{`CALIPER_TOKEN=… caliper audit http://localhost:5173/post/1 --measure "^generate$" --output textarea \\
  --server-timings http://localhost:8787`}</code></pre>
        <p className="muted">The token only goes to the origin you name in <code>--server-timings</code>.</p>

        <h2>What Caliper does not do</h2>
        <ul>
          <li>It sees timings, not your code. Its hints are common causes, not a diagnosis.</li>
          <li>Chromium only, and HTTP only: output delivered over a WebSocket isn&apos;t tied to any request.</li>
          <li>It never records or shows your prompt text. The Request Map is sizes only.</li>
          <li>It doesn&apos;t check who wrote each part. The source is your app&apos;s label.</li>
          <li>It doesn&apos;t detect prompt injection. It flags text your app labelled as from outside, and its canary check tests one technique only.</li>
          <li>The Stop and double-send checks see only the browser. Whether your server also stopped the model call needs your server&apos;s logs.</li>
        </ul>

        <h2>Links</h2>
        <ul>
          <li><a href="https://github.com/Jia-A/caliper">GitHub: Jia-A/caliper</a> (full docs)</li>
          <li><a href="https://www.npmjs.com/package/caliper-ai">npm: caliper-ai</a></li>
          <li><a href="https://www.npmjs.com/package/caliper-timings">npm: caliper-timings</a></li>
        </ul>
      </main>
    </div>
  );
}
