import type { Change } from "@sona-ai/api/events";
import { DurableObject } from "cloudflare:workers";

/**
 * One per hospital: holds the WebSockets of every app signed in to that hospital and forwards each
 * change the API announces (see packages/api/src/events.ts). Uses hibernation, so idle connections
 * cost nothing and the object sleeps between changes; "ping" is answered without waking it.
 */
export class HospitalChannel extends DurableObject {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as never);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  /** The Worker has already checked the login and the hospital; this only accepts the socket. */
  async fetch(): Promise<Response> {
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server!);
    return new Response(null, { status: 101, webSocket: client });
  }

  async announce(change: Change) {
    const message = JSON.stringify(change);
    for (const socket of this.ctx.getWebSockets()) {
      try { socket.send(message); } catch { /* a closing socket; the app reconnects and re-reads */ }
    }
  }

  async webSocketClose(socket: WebSocket, code: number) {
    try { socket.close(code, "closing"); } catch { /* already closed */ }
  }
}
