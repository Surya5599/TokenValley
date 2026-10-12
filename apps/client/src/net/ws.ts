import { ServerMessage, type ClientMessage } from "@tokenvalley/shared";

export type ConnStatus = "connecting" | "connected" | "disconnected";

/**
 * Minimal WebSocket client: parses every frame with ServerMessage.safeParse,
 * reconnects with exponential backoff, and exposes two typed listeners.
 */
export class WsClient {
  status: ConnStatus = "disconnected";
  private socket: WebSocket | null = null;
  private attempt = 0;
  private retryTimer: number | null = null;
  private stopped = false;
  private readonly messageListeners = new Set<(m: ServerMessage) => void>();
  private readonly statusListeners = new Set<(s: ConnStatus) => void>();

  constructor(private readonly url: string) {}

  onMessage(fn: (m: ServerMessage) => void): () => void {
    this.messageListeners.add(fn);
    return () => this.messageListeners.delete(fn);
  }

  onStatus(fn: (s: ConnStatus) => void): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  connect(): void {
    this.stopped = false;
    this.open();
  }

  close(): void {
    this.stopped = true;
    if (this.retryTimer !== null) window.clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.socket?.close();
    this.socket = null;
  }

  send(msg: ClientMessage): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(msg));
    return true;
  }

  private setStatus(s: ConnStatus): void {
    if (this.status === s) return;
    this.status = s;
    for (const fn of this.statusListeners) fn(s);
  }

  private open(): void {
    if (this.stopped) return;
    this.setStatus("connecting");
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.scheduleRetry();
      return;
    }
    this.socket = ws;
    ws.onopen = () => {
      this.attempt = 0;
      this.setStatus("connected");
      this.send({ kind: "hello" });
    };
    ws.onmessage = (ev: MessageEvent) => {
      if (typeof ev.data !== "string") return;
      let raw: unknown;
      try {
        raw = JSON.parse(ev.data);
      } catch {
        return;
      }
      const parsed = ServerMessage.safeParse(raw);
      if (!parsed.success) {
        console.warn("[ws] ignoring invalid message:", parsed.error.issues[0]?.message);
        return;
      }
      for (const fn of this.messageListeners) fn(parsed.data);
    };
    ws.onclose = () => {
      if (this.socket === ws) this.socket = null;
      this.setStatus("disconnected");
      this.scheduleRetry();
    };
    ws.onerror = () => {
      // onclose follows an error; the retry is scheduled there.
    };
  }

  private scheduleRetry(): void {
    if (this.stopped || this.retryTimer !== null) return;
    const delay = Math.min(8000, 500 * 2 ** this.attempt);
    this.attempt = Math.min(this.attempt + 1, 6);
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      this.open();
    }, delay);
  }
}
