import type { ClientMessage, ServerMessage } from "@airmic/shared";

export type SocketStatus = "idle" | "connecting" | "online" | "reconnecting" | "offline";

type AnyHandler = (message: ServerMessage) => void;
type StatusHandler = (status: SocketStatus) => void;

function buildUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return protocol + "//" + window.location.host + "/ws";
}

/**
 * 带自动重连的 WebSocket 客户端。
 * 通过 socket.on("hello", handler) 订阅服务端事件，socket.send 发送协议消息。
 */
class RealtimeSocket {
  private instance: WebSocket | null = null;
  private handlers = new Map<string, Set<AnyHandler>>();
  private statusHandlers = new Set<StatusHandler>();
  private status: SocketStatus = "idle";
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private allowReconnect = false;
  private manuallyClosed = false;

  connect(): void {
    if (this.instance && (this.instance.readyState === WebSocket.OPEN || this.instance.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.allowReconnect = true;
    this.manuallyClosed = false;
    this.clearReconnectTimer();
    this.openSocket(this.reconnectAttempt > 0 ? "reconnecting" : "connecting");
  }

  private openSocket(initialStatus: SocketStatus): void {
    this.setStatus(initialStatus);
    let ws: WebSocket;
    try {
      ws = new WebSocket(buildUrl());
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.instance = ws;

    ws.onopen = () => {
      this.reconnectAttempt = 0;
      this.setStatus("online");
      this.startPing();
    };

    ws.onmessage = (event) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(String(event.data)) as ServerMessage;
      } catch {
        return;
      }
      this.dispatch(message);
    };

    ws.onclose = (event) => {
      if (this.instance === ws) this.instance = null;
      this.stopPing();
      // 4xxx：服务端主动拒绝（未登录/封禁/被踢/会话失效），重连没有意义
      if (event.code >= 4000 && event.code < 5000) {
        this.allowReconnect = false;
        this.clearReconnectTimer();
        this.setStatus("offline");
        return;
      }
      if (this.manuallyClosed || !this.allowReconnect) {
        this.setStatus("offline");
        return;
      }
      this.scheduleReconnect();
    };

    ws.onerror = () => {
      /* onclose 会紧接着触发，由它统一处理重连 */
    };
  }

  private scheduleReconnect(): void {
    this.clearReconnectTimer();
    this.setStatus("reconnecting");
    const attempt = Math.min(this.reconnectAttempt, 6);
    const delay = Math.min(15_000, 700 * Math.pow(1.7, attempt)) + Math.random() * 400;
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.allowReconnect && !this.manuallyClosed) this.openSocket("reconnecting");
    }, delay);
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      this.send({ t: "ping", ts: Date.now() });
    }, 20_000);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private dispatch(message: ServerMessage): void {
    const handlers = this.handlers.get(message.t);
    if (!handlers) return;
    for (const handler of [...handlers]) {
      try {
        handler(message);
      } catch (error) {
        console.error("[ws] handler error", error);
      }
    }
  }

  disconnect(): void {
    this.manuallyClosed = true;
    this.allowReconnect = false;
    this.clearReconnectTimer();
    this.stopPing();
    if (this.instance) {
      try {
        this.instance.close(1000, "client logout");
      } catch {
        /* ignore */
      }
      this.instance = null;
    }
    this.setStatus("offline");
  }

  /** 服务端主动踢下线等场景：停止重连 */
  stopReconnect(): void {
    this.allowReconnect = false;
    this.clearReconnectTimer();
    this.setStatus("offline");
  }

  send(message: ClientMessage): boolean {
    if (!this.instance || this.instance.readyState !== WebSocket.OPEN) return false;
    try {
      this.instance.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  }

  on<T extends ServerMessage["t"]>(type: T, handler: (message: Extract<ServerMessage, { t: T }>) => void): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set<AnyHandler>();
      this.handlers.set(type, set);
    }
    const wrapped: AnyHandler = (message) => handler(message as Extract<ServerMessage, { t: T }>);
    set.add(wrapped);
    return () => {
      set?.delete(wrapped);
    };
  }

  onStatus(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler);
    handler(this.status);
    return () => {
      this.statusHandlers.delete(handler);
    };
  }

  getStatus(): SocketStatus {
    return this.status;
  }

  private setStatus(status: SocketStatus): void {
    if (this.status === status) return;
    this.status = status;
    for (const handler of [...this.statusHandlers]) {
      try {
        handler(status);
      } catch (error) {
        console.error("[ws] status handler error", error);
      }
    }
  }
}

export const socket = new RealtimeSocket();