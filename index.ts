import { createFederation, MemoryKvStore, Person } from "@fedify/fedify";
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

federation
  .setActorDispatcher
  ("/users/{identifier}", async (ctx
    , identifier
  ) => {
    if (identifier
      !== "me") return null;  // Other than "me" is not found.
    return new Person
      ({
        id
          : ctx
            .getActorUri
            (identifier
            ),
        name
          : "Me",  // Display name
        summary
          : "This is me!",  // Bio
        preferredUsername
          : identifier
        ,  // Bare handle
        url
          : new URL
            ("/", ctx
              .url
            ),
      });
  });

serve({
  port: 8000,
  fetch(request) {
    return federation.fetch(request, { contextData: undefined });
  }
});