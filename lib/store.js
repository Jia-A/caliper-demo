// caliper-timings' store: Upstash Redis when its env vars are set (Vercel), else memory (one process).
import { MemoryStore, UpstashStore } from "caliper-timings/upstash";

const memory = new MemoryStore();
export const timingStore = (env) => UpstashStore.fromEnv(env) ?? memory;
