import { DurableObject } from "cloudflare:workers";

export interface Env {
  LIVE_ROOM: DurableObjectNamespace;
  IDENTITY: DurableObjectNamespace;
  ASSETS: Fetcher;
}

export async function publicIdOf(fullId: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(fullId),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export class IdentityRegistry extends DurableObject {
  async fetch(_request: Request): Promise<Response> {
    return new Response("not implemented", { status: 501 });
  }
}
