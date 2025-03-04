import { createFederation, MemoryKvStore } from "@fedify/fedify";
import { serve } from "@hono/node-server";
import { configure, getConsoleSink } from "@logtape/logtape";

await configure({
  sinks: { console: getConsoleSink() },
  filters: {},
  loggers: [
    { category: "fedify", sinks: ["console"], lowestLevel: "info" },
  ],
});

const federation = createFederation<void>({
  kv: new MemoryKvStore(),
});

serve({
  port: 8000,
  fetch(request) {
    return federation.fetch(request, { contextData: undefined });
  }
});