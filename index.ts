import { createFederation, MemoryKvStore } from "@fedify/fedify";
import { serve } from "@hono/node-server";

const federation = createFederation<void>({
  kv: new MemoryKvStore(),
});

serve({
  port: 8000,
  fetch(request) {
    return federation.fetch(request, { contextData: undefined });
  }
});