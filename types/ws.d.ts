declare module 'ws' {
  export const WebSocket: { OPEN: number };

  export class WebSocketServer {
    constructor(options: { noServer: boolean });
    clients: Set<{ readyState: number; send(data: string): void }>;
    on(
      event: 'connection',
      listener: (socket: {
        send(data: string): void;
        on(event: 'error', listener: () => void): void;
      }) => void,
    ): void;
    handleUpgrade(
      request: import('http').IncomingMessage,
      socket: import('stream').Duplex,
      head: Buffer,
      callback: (client: unknown) => void,
    ): void;
    emit(
      event: 'connection',
      client: unknown,
      request: import('http').IncomingMessage,
    ): void;
  }
}
