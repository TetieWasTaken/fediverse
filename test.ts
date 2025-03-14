import {
	Accept,
	Endpoints,
	Follow,
	Person,
	Undo,
	createFederation,
	exportJwk,
	generateCryptoKeyPair,
	importJwk,
} from "@fedify/fedify";
import { RedisKvStore } from "@fedify/redis";
import Redis from "ioredis";
import { configure, getConsoleSink } from "@logtape/logtape";
import { serve } from "@hono/node-server";
import ngrok from "@ngrok/ngrok";

// Logging settings for diagnostics:
await configure({
	sinks: { console: getConsoleSink() },
	loggers: [
		{ category: "fedify", lowestLevel: "debug", sinks: ["console"] },
		{ category: ["logtape", "meta"], lowestLevel: "warning", sinks: ["console"] },
	],
});

const redis = new Redis();
const kv = new RedisKvStore(redis);

// A `Federation` object is the main entry point of the Fedify framework.
// It provides a set of methods to configure and run the federated server:
const federation = createFederation<void>({
	kv: kv,
});

// Registers the actor dispatcher, which is responsible for creating a
// `Actor` object (`Person` in this case) for a given actor URI.
// The actor dispatch is not only used for the actor URI, but also for
// the WebFinger resource:
federation
	.setActorDispatcher("/users/{identifier}", async (ctx, identifier) => {
		// In this demo, we're assuming that there is only one account for
		// this server: @demo@fedify-demo.deno.land
		if (identifier !== "demo") return null;
		// A `Context<TContextData>` object has several purposes, and one of
		// them is to provide a way to get the key pairs for the actor in various
		// formats:
		const keyPairs = await ctx.getActorKeyPairs(identifier);
		return new Person({
			id: ctx.getActorUri(identifier),
			name: "Fedify Demo",
			summary: "This is a Fedify Demo account.",
			preferredUsername: identifier,
			url: new URL("/", ctx.url),
			inbox: ctx.getInboxUri(identifier),
			endpoints: new Endpoints({
				sharedInbox: ctx.getInboxUri(),
			}),
			// The `publicKey` and `assertionMethods` are used by peer servers
			// to verify the signature of the actor:
			publicKey: keyPairs[0].cryptographicKey,
			assertionMethods: keyPairs.map((keyPair) => keyPair.multikey),
		});
	})
	.setKeyPairsDispatcher(async (_, identifier) => {
		if (identifier !== "demo") return [];
		const entry = await kv.get<{ privateKey: JsonWebKey; publicKey: JsonWebKey }>(["key"]);
		if (entry == null) {
			// Generate a new key pair at the first time:
			const { privateKey, publicKey } = await generateCryptoKeyPair("RSASSA-PKCS1-v1_5");
			// Store the generated key pair to the Deno KV database in JWK format:
			await kv.set(["key"], {
				privateKey: await exportJwk(privateKey),
				publicKey: await exportJwk(publicKey),
			});
			return [{ privateKey, publicKey }];
		}
		// Load the key pair from the Deno KV database:
		const privateKey = await importJwk(entry.privateKey, "private");
		const publicKey = await importJwk(entry.publicKey, "public");
		return [{ privateKey, publicKey }];
	});

// Registers the inbox listeners, which are responsible for handling
// incoming activities in the inbox:
federation
	.setInboxListeners("/users/{identifier}/inbox", "/inbox")
	// The `Follow` activity is handled by adding the follower to the
	// follower list:
	.on(Follow, async (ctx, follow) => {
		console.log("Received a follow request");
		console.log(ctx, follow);
		if (follow.id == null || follow.actorId == null || follow.objectId == null) {
			return;
		}
		const result = ctx.parseUri(follow.objectId);
		if (result == null) {
			console.error("Failed to parse URI");
			return;
		}
		if (result.type !== "actor" || result.identifier !== "demo") return;
		const follower = await follow.getActor(ctx);
		// Note that if a server receives a `Follow` activity, it should reply
		// with either an `Accept` or a `Reject` activity.  In this case, the
		// server automatically accepts the follow request:
		if (follower == null) {
			console.error("Failed to get follower actor");
			return;
		} else if (follower.id == null) {
			console.error("Follower actor ID is null");
			return;
		}

		await ctx.sendActivity(
			{ handle: result.identifier },
			follower,
			new Accept({
				id: new URL(`#accepts/${follower.id.href}`, ctx.getActorUri(result.identifier)),
				actor: follow.objectId,
				object: follow,
			})
		);
		await kv.set(["followers", follow.id.href], follow.actorId.href);
	})
	// The `Undo` activity purposes to undo the previous activity.  In this
	// project, we use the `Undo` activity to represent someone unfollowing
	// this demo app:
	.on(Undo, async (ctx, undo) => {
		const activity = await undo.getObject(ctx); // An `Activity` to undo
		if (activity instanceof Follow) {
			if (activity.id == null) return;
			await kv.delete(["followers", activity.id.href]);
		} else {
			console.debug(undo);
		}
	});

serve({
	port: 8080,
	async fetch(request) {
		const url = new URL(request.url);
		// The home page:
		if (url.pathname === "/") {
			const followers: string[] = [];
			const keys = await redis.keys("followers:*");
			for (const key of keys) {
				const value = await redis.get(key);
				if (value && !followers.includes(value)) {
					followers.push(value);
				}
			}
			return new Response(`\
 _____        _ _  __         ____
|  ___|__  __| (_)/ _|_   _  |  _ \\  ___ _ __ ___   ___
| |_ / _ \\/ _\` | | |_| | | | | | | |/ _ \\ '_ \` _ \\ / _ \\
|  _|  __/ (_| | |  _| |_| | | |_| |  __/ | | | | | (_) |
|_|  \\___|\\__,_|_|_|  \\__, | |____/ \\___|_| |_| |_|\\___/
                      |___/

This small federated server app is a demo of Fedify. The only one
thing it does is to accept follow requests.

You can follow this demo app via the below handle:

    @demo@${url.host}

This account has the below ${followers.length} followers:

    ${followers.join("\n    ")}
`);
		}

		// The `federation` object purposes to handle federation-related requests.
		// It is responsible for handling, for example, WebFinger queries, actor
		// dispatching, and incoming activities to the inbox:
		return await federation.fetch(request, {
			// The context data is not used in this example, but it can be used to
			// store data (e.g., database connections) that is shared between
			// the different federation-related callbacks:
			contextData: undefined,
		});
	},
});

await ngrok.connect({ addr: 8080, authtoken: process.env.NGROK_AUTHTOKEN }).then((listener) => {
	console.log(`Server running at ${listener.url()}`);
});
