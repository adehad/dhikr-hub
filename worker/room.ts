import { DurableObject } from "cloudflare:workers";

export class LiveRoom extends DurableObject {
  async fetch(_request: Request): Promise<Response> {
    return new Response("not implemented", { status: 501 });
  }
}
