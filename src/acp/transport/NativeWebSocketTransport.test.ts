import { afterEach, describe, expect, it, vi } from 'vitest';
import { NativeWebSocketTransport, type NativeWebSocketEvent } from './NativeWebSocketTransport';
import { createWebSocketTransport, setWebSocketHost } from './webSocketHost';
import { WebSocketTransport } from './WebSocketTransport';

afterEach(() => setWebSocketHost(null));

function harness() {
  let receive!: (event: NativeWebSocketEvent) => void;
  const socket = { write: vi.fn(async (_data: string) => {}), close: vi.fn(async () => {}) };
  const transport = new NativeWebSocketTransport('wss://example.com/acp', async (_url, onEvent) => {
    receive = onEvent;
    // A fast server can answer before IPC returns the socket id.
    onEvent({ type: 'text', data: '{"jsonrpc":"2.0","id":1,"result":{}}' });
    return socket;
  });
  return { transport, socket, receive: (event: NativeWebSocketEvent) => receive(event) };
}

describe('native authenticated WebSocket transport', () => {
  it('preserves early messages and writes one JSON frame per message', async () => {
    const h = harness();
    const stream = await h.transport.connect();
    const reader = stream.readable.getReader();
    expect((await reader.read()).value).toEqual({ jsonrpc: '2.0', id: 1, result: {} });
    await stream.writable.getWriter().write({ jsonrpc: '2.0', id: 2, method: 'initialize' });
    expect(h.socket.write).toHaveBeenCalledWith('{"jsonrpc":"2.0","id":2,"method":"initialize"}');
    h.transport.disconnect();
    expect(await h.transport.closed).toBe(1000);
    expect((await reader.read()).done).toBe(true);
    expect(h.socket.close).toHaveBeenCalledTimes(1);
  });

  it('closes a socket that finishes opening after its owner disconnected', async () => {
    let resolve!: (socket: { write: (data: string) => Promise<void>; close: () => Promise<void> }) => void;
    const socket = { write: vi.fn(async () => {}), close: vi.fn(async () => {}) };
    const transport = new NativeWebSocketTransport('wss://example.com', () => new Promise((done) => { resolve = done; }));
    const pending = transport.connect();
    transport.disconnect();
    resolve(socket);
    await expect(pending).rejects.toThrow('closed while opening');
    expect(socket.close).toHaveBeenCalledTimes(1);
  });

  it('reports rejected authentication with its useful error', async () => {
    const transport = new NativeWebSocketTransport('wss://example.com', async () => {
      throw new Error('Server sign-in is required (HTTP 302).');
    });
    const error = vi.fn();
    transport.onError(error);
    await expect(transport.connect()).rejects.toThrow('sign-in is required');
    expect(await transport.closed).toBe(1006);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('settles once on remote close, ignoring late messages', async () => {
    const h = harness();
    const stream = await h.transport.connect();
    const reader = stream.readable.getReader();
    await reader.read();
    const close = vi.fn();
    h.transport.onClose(close);
    h.receive({ type: 'close', code: 4401 });
    h.receive({ type: 'text', data: '{}' });
    h.receive({ type: 'close', code: 1000 });
    expect(await h.transport.closed).toBe(4401);
    expect((await reader.read()).done).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed messages and closes the native connection', async () => {
    const h = harness();
    await h.transport.connect();
    const error = vi.fn();
    h.transport.onError(error);
    h.receive({ type: 'text', data: 'not json' });
    expect(await h.transport.closed).toBe(1007);
    expect(error).toHaveBeenCalledTimes(1);
    expect(h.socket.close).toHaveBeenCalledTimes(1);
  });

  it('uses the native factory only when a host is registered', () => {
    expect(createWebSocketTransport('wss://example.com')).toBeInstanceOf(WebSocketTransport);
    const h = harness();
    const transport = vi.fn(() => h.transport);
    setWebSocketHost({ transport, signIn: async () => {} });
    expect(createWebSocketTransport('wss://example.com/acp')).toBe(h.transport);
    expect(transport).toHaveBeenCalledWith('wss://example.com/acp');
  });
});
