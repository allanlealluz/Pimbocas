import type { RodId } from "../domain/types";
import type { MatchSnapshot } from "./snapshot";

/**
 * Interface de transporte para gameplay realtime.
 * A ideia é permitir trocar a implementação sem reescrever a lógica da partida.
 *
 * Implementação atual: PeerTransport (WebRTC/PeerJS), host autoritativo.
 * Evolução: WebSocketTransport com servidor autoritativo (Durable Object).
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
  /** Abre o transporte local. Com `remoteId`, inicia a conexão com o par. */
  connect(remoteId?: string): Promise<void>;
  disconnect(): Promise<void>;
  send<T>(payload: T): void;
  on<T extends TransportEventType>(type: T, handler: TransportHandler<T>): () => void;
}

/** Mensagens de jogo devem ser pequenas, explícitas e versionáveis. */
export type GameMessage =
  | { type: "hello"; heroId: string; displayName: string }
  /** `seq` permite descartar mensagens atrasadas e detectar input parado. */
  | { type: "input"; rod: RodId; axis: -1 | 0 | 1; seq: number }
  | { type: "kick"; rod: RodId; power: number; direction: 1 | -1 }
  | { type: "ability_activate"; abilityId: string }
  | { type: "snapshot"; snapshot: MatchSnapshot }
  | { type: "ping"; t: number }
  | { type: "pong"; t: number };
