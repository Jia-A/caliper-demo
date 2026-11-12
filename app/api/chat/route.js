// POST /api/chat. The work is in lib/chat.js; after() keeps the function alive for caliper-timings'
// save after the response (Next.js 15.1+).
import { after } from "next/server";
import { handleChat } from "../../../lib/chat.js";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export function POST(request) {
  return handleChat(request, { env: process.env, defer: (p) => after(() => p) });
}
