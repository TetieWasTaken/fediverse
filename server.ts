import { createFederation, MemoryKvStore, Person, Follow, exportJwk, generateCryptoKeyPair, importJwk } from "@fedify/fedify";
import { serve } from "@hono/node-server";
import { configure, getConsoleSink } from "@logtape/logtape";
import ngrok from "@ngrok/ngrok";

await configure({
  sinks: { console: getConsoleSink() },
  filters: {},
  loggers: [{ category: "fedify", sinks: ["console"], lowestLevel: "info" }],
});

const federation = createFederation<void>({
  kv: new MemoryKvStore(),
});

federation.setInboxListeners("/users/{identifier}/inbox", "/inbox").on(Follow, async (ctx, follow) => {
  if (follow.id == null || follow.actorId == null || follow.objectId == null) {
    return;
  }
  const parsed = ctx.parseUri(follow.objectId);
  if (parsed?.type !== "actor" || parsed.identifier !== "me") return;
  const follower = await follow.getActor(ctx);
  console.debug(follower);
});

federation.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
  if (identifier !== "me") return null; // Other than "me" is not found.
  return new Person({
    id: ctx.getActorUri(identifier),
    name: "Me", // Display name
    summary: "This is me!", // Bio
    preferredUsername: identifier, // Bare handle
    url: new URL("/", ctx.url),
    inbox: ctx.getInboxUri(identifier),
  });
});

serve({
  port: 8080,
  fetch(request) {
    return federation.fetch(request, { contextData: undefined });
  },
});

await ngrok.connect({ addr: 8080, authtoken_from_env: true }).then((listener) => {
  console.log(`Server running at ${listener.url()}`);
});
