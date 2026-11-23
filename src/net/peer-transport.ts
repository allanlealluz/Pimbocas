import Peer, { type DataConnection } from "peerjs";
import type {
  RealtimeTransport,
  TransportEventMap,
  TransportEventType,
  TransportHandler,
} from "./transport";

const CONTROL_LABEL = "pimbocas-control";
const STATE_LABEL = "pimbocas-state";

/**
 * Transporte WebRTC usando o servidor de sinalização público do PeerJS.
 * Não precisa de Cloud Functions: o Firebase continua responsável só por Auth,
 * perfil e dados de jogador.
 *
 * Dois canais:
 *  - controle (confiável/ordenado): input, chute, habilidade, hello;
 *  - estado (não-confiável/não-ordenado): snapshots. Se um snapshot se perder,
 *    o próximo já corrige — esperar retransmissão causava picos de lag.
 */
export class PeerTransport implements RealtimeTransport {
  readonly kind = "peerjs" as const;

  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  private stateConn: DataConnection | null = null;

  private readonly handlers: { [K in TransportEventType]: Set<TransportHandler<K>> } = {
    open: new Set(),
    connected: new Set(),
    disconnected: new Set(),
    message: new Set(),
    error: new Set(),
  };

  constructor(private readonly localId: string) {}

  get peerId(): string { return this.localId; }

  on<K extends TransportEventType>(type: K, handler: TransportHandler<K>): () => void {
    this.handlers[type].add(handler);
    return () => { this.handlers[type].delete(handler); };
  }

  private emit<K extends TransportEventType>(type: K, event: TransportEventMap[K]): void {
    this.handlers[type].forEach((handler) => handler(event));
  }

  async connect(remoteId?: string): Promise<void> {
    if (!this.peer) {
      this.peer = new Peer(this.localId, {
        debug: 0,
        config: {
          iceServers: [
            { urls: "stun:stun.l.google.com:19302" },
            { urls: "stun:stun1.l.google.com:19302" },
            { urls: "stun:global.stun.twilio.com:3478" },
          ],
        },
      });
      this.peer.on("connection", (conn) => this.attach(conn));
      this.peer.on("error", (error) => this.emit("error", { message: error.message }));
      this.peer.on("disconnected", () => {
        this.emit("disconnected", { reason: "Conexão com o sinalizador perdida." });
      });

      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(
          () => reject(new Error("Tempo limite ao conectar com o sinalizador PeerJS.")),
          12_000,
        );
        this.peer!.once("open", () => {
          window.clearTimeout(timer);
          this.emit("open", { peerId: this.localId });
          resolve();
        });
        this.peer!.once("error", (error: Error) => {
          window.clearTimeout(timer);
          reject(error);
        });
      });
    }

    if (remoteId && !this.conn) {
      this.attach(this.peer.connect(remoteId, { reliable: true, label: CONTROL_LABEL }));
      this.attach(this.peer.connect(remoteId, { reliable: false, label: STATE_LABEL }));
    }
  }

  private attach(conn: DataConnection): void {
    const isState = conn.label === STATE_LABEL;
    if (isState) {
      if (this.stateConn && this.stateConn !== conn) this.stateConn.close();
      this.stateConn = conn;
    } else {
      if (this.conn && this.conn !== conn) this.conn.close();
      this.conn = conn;
    }

    conn.on("open", () => {
      // O "connected" da partida é o canal de controle (onde vão os inputs).
      if (!isState) this.emit("connected", { remoteId: conn.peer });
    });
    conn.on("data", (data) => {
      this.emit("message", { from: conn.peer, payload: data });
    });
    conn.on("close", () => {
      if (isState && this.stateConn === conn) this.stateConn = null;
      if (!isState && this.conn === conn) this.conn = null;
      if (!isState) {
        this.emit("disconnected", { remoteId: conn.peer, reason: "O adversário saiu da partida." });
      }
    });
    conn.on("error", (error) => this.emit("error", { message: error.message }));
  }

  send<T>(payload: T): void {
    const isSnapshot = !!payload && typeof payload === "object"
      && (payload as { type?: string }).type === "snapshot";
    const conn = isSnapshot ? this.stateConn : this.conn;
    if (!conn?.open) {
      // Perder um snapshot é normal no canal não-confiável; o próximo resolve.
      if (!isSnapshot) this.emit("error", { message: "Conexão com o adversário ainda não está aberta." });
      return;
    }
    conn.send(payload);
  }

  async disconnect(): Promise<void> {
    this.conn?.close();
    this.stateConn?.close();
    this.conn = null;
    this.stateConn = null;
    if (this.peer && !this.peer.destroyed) this.peer.destroy();
    this.peer = null;
  }
}
