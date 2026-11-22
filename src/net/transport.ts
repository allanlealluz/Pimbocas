/**
 * Interface de transporte para gameplay realtime.
 * A ideia é permitir trocar a implementação sem reescrever a lógica da partida.
 *
 * MVP sugerido: PeerTransport (WebRTC/PeerJS), host autoritativo.
 * Evolução: WebSocketTransport com servidor autoritativo.
 */

export type TransportEventMap = {
  open: { peerId: string };
  connected: { remoteId: string };
  disconnected: { remoteId?: string; reason?: string };
  message: { from: string; payload: unknown };
  error: { message: string };
};

export type TransportEventType = keyof TransportEventMap;
export type TransportHandler<T extends TransportEventType> = (event: TransportEventMap[T]) => void;

export interface RealtimeTransport {
  readonly kind: "peerjs" | "websocket";
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send<T>(payload: T): void;
  on<T extends TransportEventType>(type: T, handler: TransportHandler<T>): () => void;
}

/** Mensagens de jogo devem ser pequenas, explícitas e versionáveis. */
export type GameMessage =
  | { type: "input"; tick: number; rod: string; axis: number; rotation: number }
  | { type: "ability_activate"; tick: number; abilityId: string }
  | { type: "state_snapshot"; tick: number; state: unknown }
  | { type: "ping"; t: number }
  | { type: "pong"; t: number };
