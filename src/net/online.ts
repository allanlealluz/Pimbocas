import type { PlayerProfile } from "./firebase";
import { PeerTransport } from "./peer-transport";
import type { GameMessage, RealtimeTransport } from "./transport";

export type OnlinePhase = "idle" | "queue" | "connecting" | "connected" | "error";

export interface OnlineSession {
  transport: RealtimeTransport;
  isHost: boolean;
  localHeroId: string;
  remoteHeroId: string;
  localName: string;
  remoteName: string;
  roomCode: string;
}

export interface OnlineCallbacks {
  onStatus: (phase: OnlinePhase, message: string, roomCode?: string) => void;
  onReady: (session: OnlineSession) => void;
  onMessage: (message: GameMessage) => void;
  onDisconnected: (reason?: string) => void;
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateCode(): string {
  let suffix = "";
  for (let i = 0; i < 6; i += 1) {
    suffix += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]!;
  }
  return `PIMBO-${suffix}`;
}

export function normalizeRoomCode(raw: string): string {
  const clean = raw.trim().toUpperCase().replace(/[\s_]+/g, "-");
  const code = clean.startsWith("PIMBO-") ? clean : `PIMBO-${clean}`;
  if (!/^PIMBO-[A-Z0-9]{6}$/.test(code)) {
    throw new Error("Código inválido. Use o formato PIMBO-XXXXXX.");
  }
  return code;
}

function randomPeerId(): string {
  return `pb${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Sala 1v1 por código. Quem cria é o host (simula e transmite snapshots);
 * quem entra só envia inputs. Tudo passa pelo PeerJS, sem Firebase/Functions.
 */
export class OnlineController {
  private transport: PeerTransport | null = null;
  private remoteInfo: { heroId: string; displayName: string } | null = null;
  private connected = false;
  private ready = false;
  private isHost = false;
  private roomCode: string | null = null;
  private timer: number | null = null;

  constructor(
    private readonly profile: PlayerProfile,
    private readonly heroId: string,
    private readonly callbacks: OnlineCallbacks,
  ) {}

  private status(phase: OnlinePhase, message: string): void {
    this.callbacks.onStatus(phase, message, this.roomCode ?? undefined);
  }

  private startTimer(message: string): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      if (!this.ready) this.status("error", `${message} Tempo limite: verifique o código e a conexão.`);
    }, 25_000);
  }

  private clearTimer(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
  }

  private async openTransport(id: string): Promise<void> {
    this.transport = new PeerTransport(id);
    this.transport.on("connected", () => {
      this.connected = true;
      this.send({
        type: "hello",
        heroId: this.heroId,
        displayName: this.profile.displayName || "Jogador",
      });
      this.maybeReady();
    });
    this.transport.on("message", ({ payload }) => {
      const message = payload as GameMessage;
      if (message?.type === "hello") {
        this.remoteInfo = { heroId: message.heroId, displayName: message.displayName };
        this.maybeReady();
        return;
      }
      this.callbacks.onMessage(message);
    });
    this.transport.on("disconnected", ({ reason }) => {
      if (!this.ready) return;
      this.callbacks.onDisconnected(reason);
    });
    this.transport.on("error", ({ message }) => {
      if (this.ready) return;
      const detail = message.toLowerCase().includes("unavailable")
        ? "Sala não encontrada. Confira se o amigo criou a sala e se o código está correto."
        : message;
      this.status("error", detail);
    });
    await this.transport.connect();
  }

  private maybeReady(): void {
    if (this.ready || !this.connected || !this.remoteInfo || !this.transport) return;
    this.ready = true;
    this.clearTimer();
    this.status("connected", "Conectado! Iniciando partida…");
    this.callbacks.onReady({
      transport: this.transport,
      isHost: this.isHost,
      localHeroId: this.heroId,
      remoteHeroId: this.remoteInfo.heroId,
      localName: this.profile.displayName || "Você",
      remoteName: this.remoteInfo.displayName || "Adversário",
      roomCode: this.roomCode ?? "",
    });
  }

  async createRoom(): Promise<string> {
    const code = generateCode();
    this.isHost = true;
    this.roomCode = code;
    try {
      await this.openTransport(code);
    } catch (error) {
      this.status("error", error instanceof Error ? error.message : "Não foi possível criar a sala.");
      return code;
    }
    this.status("queue", `Sala criada. Envie o código ${code} para o seu amigo.`);
    this.startTimer("Ninguém entrou na sala.");
    return code;
  }

  async joinRoom(rawCode: string): Promise<void> {
    let code: string;
    try {
      code = normalizeRoomCode(rawCode);
    } catch (error) {
      this.status("error", error instanceof Error ? error.message : "Código inválido.");
      return;
    }
    this.isHost = false;
    this.roomCode = code;
    try {
      await this.openTransport(randomPeerId());
      this.status("connecting", `Entrando na sala ${code}…`);
      await this.transport!.connect(code);
      this.startTimer("O host não respondeu.");
    } catch (error) {
      this.status("error", error instanceof Error ? error.message : "Não foi possível entrar na sala.");
    }
  }

  send(message: GameMessage): void {
    this.transport?.send(message);
  }

  async cancel(): Promise<void> {
    this.clearTimer();
    await this.transport?.disconnect();
    this.transport = null;
    this.remoteInfo = null;
    this.connected = false;
    this.ready = false;
    this.roomCode = null;
  }
}
