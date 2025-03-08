import {
	createFederation,
	MemoryKvStore,
	Person,
	Follow,
	exportJwk,
	generateCryptoKeyPair,
	importJwk,
	Accept,
} from "@fedify/fedify";
import { serve } from "@hono/node-server";

class ExtendedMemoryKvStore extends MemoryKvStore {
	store: { [key: string]: any } = {};
	async *list<T>(options: { prefix: string[] }): AsyncIterable<{ key: string[]; value: T }> {
		for (const [key, value] of Object.entries(this.store)) {
			if (key.startsWith(options.prefix.join("/"))) {
				yield { key: key.split("/"), value: value as T };
			}
		}
	}
}

const kv = new ExtendedMemoryKvStore();
import { configure, getConsoleSink } from "@logtape/logtape";
import ngrok from "@ngrok/ngrok";

await configure({
	sinks: { console: getConsoleSink() },
	filters: {},
	loggers: [{ category: "fedify", sinks: ["console"], lowestLevel: "info" }],
});

const federation = createFederation<void>({
	kv,
});

federation.setInboxListeners("/users/{identifier}/inbox", "/inbox").on(Follow, async (ctx, follow) => {
	console.log("Received Follow activity:", follow);
	if (follow.id == null || follow.actorId == null || follow.objectId == null) {
		console.log("Follow activity is missing required fields.");
		return;
	}
	const parsed = ctx.parseUri(follow.objectId);
	if (parsed?.type !== "actor" || parsed.identifier !== "me") {
		console.log("Follow activity is not for 'me'.");
		return;
	}
	const follower = await follow.getActor(ctx);
	if (follower == null) {
		console.log("Follower actor could not be retrieved.");
		return;
	}
	console.log(`${follower.name} followed me!`);
	await ctx.sendActivity(
		{ identifier: parsed.identifier },
		follower,
		new Accept({
			actor: follow.objectId,
			object: follow,
		})
	);

	await kv.set(["followers", follow.id.href], follow.actorId.href);
	console.log("Follower saved to KV store.");
});

federation
	.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
		console.log(`Actor dispatcher called with identifier: ${identifier}`);
		if (identifier !== "me") return null; // Other than "me" is not found.
		return new Person({
			id: ctx.getActorUri(identifier),
			name: "Me", // Display name
			summary: "This is me!", // Bio
			preferredUsername: identifier, // Bare handle
			url: new URL("/", ctx.url),
			inbox: ctx.getInboxUri(identifier),
			publicKeys: (await ctx.getActorKeyPairs(identifier)).map((key) => key.cryptographicKey),
		});
	})
	.setKeyPairsDispatcher(async (ctx, identifier) => {
		console.log(`Key pairs dispatcher called with identifier: ${identifier}`);
		if (identifier != "me") return []; // Other than "me" is not found.
		const entry = await kv.get<{
			privateKey: JsonWebKey;
			publicKey: JsonWebKey;
		}>(["key"]);
		if (entry == null) {
			console.log("No key pair found, generating new key pair.");
			// Generate a new key pair at the first time:
			const { privateKey, publicKey } = await generateCryptoKeyPair("RSASSA-PKCS1-v1_5");
			// Store the generated key pair to the Deno KV database in JWK format:
			await kv.set(["key"], {
				privateKey: await exportJwk(privateKey),
				publicKey: await exportJwk(publicKey),
			});
			return [
				{
					privateKey,
					publicKey,
				},
			];
		}
		// Load the key pair from the Deno KV database:
		const privateKey = await importJwk(entry.privateKey, "private");
		const publicKey = await importJwk(entry.publicKey, "public");
		return [
			{
				privateKey,
				publicKey,
			},
		];
	});

serve({
	port: 8080,
	async fetch(request) {
		const url = new URL(request.url);
		console.log(`Received request for URL: ${url.pathname}`);
		// The home page:
		if (url.pathname === "/") {
			const followers: string[] = [];
			for await (const entry of kv.list<string>({
				prefix: ["followers"],
			})) {
				if (followers.includes(entry.value)) continue;
				followers.push(entry.value);
			}
			return new Response(`<ul>${followers.map((f) => `<li>${f}</li>`)}</ul>`, {
				headers: { "Content-Type": "text/html; charset=utf-8" },
			});
		}

		return federation.fetch(request, { contextData: undefined });
	},
});

await ngrok.connect({ addr: 8080, authtoken: process.env.NGROK_AUTHTOKEN }).then((listener) => {
	console.log(`Server running at ${listener.url()}`);
});
