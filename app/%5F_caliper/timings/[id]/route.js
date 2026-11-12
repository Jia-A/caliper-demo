// GET /__caliper/timings/:id for Caliper's marked visits. The folder is "%5F_caliper": a folder
// starting with "_" is private in the App Router, and %5F (an encoded "_") makes the URL "__caliper".
// Without CALIPER_TOKEN it answers like any unknown route.
import { handle } from "caliper-timings/upstash";
import { timingStore } from "../../../../lib/store.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const options = { token: process.env.CALIPER_TOKEN, store: timingStore(process.env) };
  return (await handle(request, options)) ?? new Response("Not found", { status: 404 });
}
