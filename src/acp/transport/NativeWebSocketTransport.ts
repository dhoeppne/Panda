import type { AnyMessage, Stream } from '@agentclientprotocol/sdk';
import type { AcpTransport } from './AcpTransport';

export type NativeWebSocketEvent =
  | { type: 'text'; data: string }
  | { type: 'close'; code: number; error?: string };

export interface NativeWebSocket {
  write(data: string): Promise<void>;
  close(): Promise<void>;
}

export type NativeWebSocketConnect = (
  url: string,
  onEvent: (event: NativeWebSocketEvent) => void,
) => Promise<NativeWebSocket>;

/** ACP message framing over a native socket. Authentication cookies stay in the native host. */
export class NativeWebSocketTransport implements AcpTransport {
  private started = false;
  private stopped = false;
  private socket: NativeWebSocket | null = null;
  private controller: ReadableStreamDefaultController<AnyMessage> | null = null;
  private readonly closeHandlers = new Set<() => void>();
  private readonly errorHandlers = new Set<(error: Error) => void>();
  private resolveClosed!: (code: number) => void;
  readonly closed = new Promise<number>((resolve) => { this.resolveClosed = resolve; });

  constructor(private readonly url: string, private readonly open: NativeWebSocketConnect) {}

  async connect(): Promise<Stream> {
    if (this.started || this.stopped) throw new Error('This connection has already been used.');
    this.started = true;
    // The channel may deliver messages before the native connect promise resolves.
    const readable = new ReadableStream<AnyMessage>({
      start: (controller) => { this.controller = controller; },
      cancel: () => this.disconnect(),
    });
    try {
      this.socket = await this.open(this.url, (event) => this.receive(event));
    } catch (error) {
      this.finish(1006, error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
    if (this.stopped) {
      await this.closeSocket();
      throw new Error('Connection closed while opening.');
    }
    return {
      readable,
      writable: new WritableStream<AnyMessage>({
        write: async (message) => {
          if (this.stopped) throw new Error('Connection is closed.');
          try {
            await this.socket!.write(JSON.stringify(message));
          } catch (error) {
            this.finish(1006, error instanceof Error ? error : new Error(String(error)));
            void this.closeSocket();
            throw error;
          }
        },
        close: () => this.disconnect(),
        abort: () => this.disconnect(),
      }),
    };
  }

  disconnect(): void {
    this.finish(1000);
    void this.closeSocket();
  }

  onClose(handler: () => void): () => void {
    this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }

  onError(handler: (error: Error) => void): () => void {
    this.errorHandlers.add(handler);
    return () => this.errorHandlers.delete(handler);
  }

  private receive(event: NativeWebSocketEvent): void {
    if (this.stopped) return;
    if (event.type === 'close') {
      this.finish(event.code, event.error ? new Error(event.error) : undefined);
      return;
    }
    try {
      this.controller!.enqueue(JSON.parse(event.data) as AnyMessage);
    } catch {
      this.finish(1007, new Error('The server sent an invalid JSON message.'));
      void this.closeSocket();
    }
  }

  private finish(code: number, error?: Error): void {
    if (this.stopped) return;
    this.stopped = true;
    this.resolveClosed(code);
    // Closing rather than erroring also works when connect() failed before a reader existed.
    try { this.controller?.close(); } catch { /* Consumer already cancelled. */ }
    if (error) {
      for (const handler of this.errorHandlers) handler(error);
    } else {
      for (const handler of this.closeHandlers) handler();
    }
  }

  private async closeSocket(): Promise<void> {
    const socket = this.socket;
    this.socket = null;
    try { await socket?.close(); } catch { /* Native actor has already closed. */ }
  }
}
