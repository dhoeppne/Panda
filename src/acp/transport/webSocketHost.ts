import type { AcpTransport } from './AcpTransport';
import { WebSocketTransport } from './WebSocketTransport';

/** Native host capabilities are injected at desktop boot; browser code never imports Tauri. */
export interface WebSocketHost {
  transport(url: string): AcpTransport;
  signIn(url: string): Promise<void>;
}

let host: WebSocketHost | null = null;

export function setWebSocketHost(next: WebSocketHost | null): void {
  host = next;
}

export function getWebSocketHost(): WebSocketHost | null {
  return host;
}

export function createWebSocketTransport(url: string): AcpTransport {
  return host?.transport(url) ?? new WebSocketTransport(url);
}
