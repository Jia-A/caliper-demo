"use client";
// A small chat: the question goes to /api/chat with the last few messages, and the reply streams
// into #reply. Caliper measures it with --input "#prompt" --prompt "…" --output "#reply".
import { useState } from "react";

const MAX_CHARS = 500;
const MAX_MESSAGES = 6;

export default function Page() {
  const [history, setHistory] = useState([]);
  const [prompt, setPrompt] = useState("");
  const [reply, setReply] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function send(event) {
    event.preventDefault();
    const question = prompt.trim();
    if (!question || busy) return;
    const messages = [...history, { role: "user", content: question }].slice(-MAX_MESSAGES);
    setBusy(true);
    setError("");
    setReply("");
    setPrompt("");
    try {
      const res = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages }) });
      if (!res.ok) {
        setError((await res.json().catch(() => null))?.error ?? "Something went wrong.");
        return;
      }
      let text = "";
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        text += value;
        setReply(text);
      }
      setHistory([...messages, { role: "assistant", content: text }].slice(-(MAX_MESSAGES - 1)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "32px 16px" }}>
      <h1 style={{ fontSize: 24 }}>Caliper demo</h1>
      <p style={{ color: "#555" }}>Ask about Caliper. Replies are short, and there&apos;s a small limit per visitor.</p>
      <p style={{ color: "#555" }}>Demo runs on a free model tier — don&apos;t type anything private.</p>
      <ol style={{ paddingLeft: 20 }}>
        {history.map((m, i) => (
          <li key={i} style={{ margin: "8px 0", color: m.role === "user" ? "#111" : "#333" }}>
            <b>{m.role === "user" ? "You" : "Demo"}:</b> {m.content}
          </li>
        ))}
      </ol>
      <div id="reply" aria-live="polite" style={{ minHeight: 48, whiteSpace: "pre-wrap", padding: 12, background: "#fff", border: "1px solid #ddd", borderRadius: 8 }}>
        {reply}
      </div>
      {error && <p role="alert" style={{ color: "#a00" }}>{error}</p>}
      <form onSubmit={send} style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <input id="prompt" value={prompt} maxLength={MAX_CHARS} onChange={(e) => setPrompt(e.target.value)} placeholder="Ask something" aria-label="Your question" style={{ flex: 1, padding: 10, fontSize: 16 }} />
        <button type="submit" disabled={busy} style={{ padding: "10px 16px", fontSize: 16 }}>Send</button>
      </form>
    </main>
  );
}
