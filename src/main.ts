import "./style.css";
import { HEROES } from "./domain/heroes";
import type { RodId } from "./domain/types";
import {
  attachInputListeners,
  createInputState,
  keyLabel,
  type ControlScheme,
} from "./game/input";
import {
  createDemoMatch,
  createOnlineMatch,
  getEquippedAbilityIds,
  movePlayerRod,
  moveRodForPlayer,
  performKick,
  performKickForPlayer,
  tryActivateAbility,
  updateMatch,
  type MatchState,
} from "./game/match";
import { applySnapshot, serializeMatch } from "./net/snapshot";
import { OnlineController, type OnlineSession } from "./net/online";
import type { GameMessage } from "./net/transport";
import { renderField } from "./ui/field";
import { renderHud } from "./ui/hud";
import { AppFlow } from "./ui/flow";

const input = createInputState("ataque");
let match: MatchState | null = null;
let previewAbilityId: string | null = null;

let online: OnlineController | null = null;
let session: OnlineSession | null = null;
let remoteInput: { rod: RodId; axis: -1 | 0 | 1 } = { rod: "ataque", axis: 0 };
let lastSnapshotAt = 0;
let matchResultShown = false;

// Confiabilidade do input: sequência para descartar atrasados, heartbeat para o
// host saber que o cliente ainda está vivo e suavização dos snapshots recebidos.
let inputSeq = 0;
let remoteSeq = 0;
let lastRemoteInputAt = 0;
let lastHeartbeatAt = 0;
let lastAppliedTick = -1;
let visualTarget: { ball: { x: number; y: number }; rods: Map<string, number> } | null = null;
let rttMs: number | null = null;
let lastPingAt = 0;
let receivedSnapshots = 0;

function resetInput(): void {
  input.selectedRod = "ataque";
  input.moveAxis = 0;
  input.charging = null;
  input.lastKickPower = null;
  previewAbilityId = null;
  remoteInput = { rod: "ataque", axis: 0 };
  lastSnapshotAt = 0;
  matchResultShown = false;
  inputSeq = 0;
  remoteSeq = 0;
  lastRemoteInputAt = 0;
  lastHeartbeatAt = 0;
  lastAppliedTick = -1;
  visualTarget = null;
  rttMs = null;
  lastPingAt = 0;
  receivedSnapshots = 0;
}

function rodKey(side: string, id: string): string {
  return `${side}:${id}`;
}

function sendInput(): void {
  if (!session || session.isHost) return;
  inputSeq += 1;
  online?.send({ type: "input", rod: input.selectedRod, axis: input.moveAxis, seq: inputSeq });
}

/** Se a aba perder o foco, o keyup pode nunca chegar: solta o input ativamente. */
function releaseInputOnBlur(): void {
  if (!session || session.isHost) return;
  input.moveAxis = 0;
  input.charging = null;
  if (match) for (const rod of match.rods) rod.charge = 0;
  sendInput();
}
window.addEventListener("blur", releaseInputOnBlur);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) releaseInputOnBlur();
});

function cleanupOnline(): void {
  void online?.cancel();
  online = null;
  session = null;
  resetInput();
}

const flow = new AppFlow({
  root: document.getElementById("screen-root") as HTMLElement,
  gameScreen: document.getElementById("game-screen") as HTMLElement,
  onStartMatch: (heroId, difficulty) => {
    if (session) return; // durante o online, reiniciar dependence do host
    match = createDemoMatch(heroId, difficulty);
    resetInput();
    renderAll();
  },
  onStartOnline: (mode, code) => {
    const profile = flow.getProfile();
    if (!profile) return;
    cleanupOnline();
    online = new OnlineController(profile, flow.getHeroId(), {
      onStatus: (_phase, message, roomCode) => flow.setOnlineStatus(message, roomCode),
      onReady: (readySession) => startOnlineSession(readySession),
      onMessage: (message) => handleOnlineMessage(message),
      onDisconnected: (reason) => {
        flow.exitOnlineToMenu();
        flow.setOnlineStatus(reason ?? "O adversário saiu da sala.");
      },
    });
    if (mode === "create") void online.createRoom();
    else void online.joinRoom(code ?? "");
  },
  onCancelOnline: () => cleanupOnline(),
  onEndMatch: () => {
    match = null;
    cleanupOnline();
  },
  onControlsChange: (scheme) => attachControls(scheme),
});

function startOnlineSession(ready: OnlineSession): void {
  session = ready;
  const remoteHeroId = HEROES[ready.remoteHeroId] ? ready.remoteHeroId : "paulo";
  match = createOnlineMatch(
    ready.localHeroId,
    remoteHeroId,
    ready.localName,
    ready.remoteName,
    ready.isHost,
    ready.isHost ? "left" : "right",
  );
  resetInput();
  flow.enterOnlineGame();
  renderAll();
}

function handleOnlineMessage(message: GameMessage): void {
  if (!match || !session) return;
  switch (message.type) {
    case "input":
      if (message.seq < remoteSeq) break; // mensagem atrasada
      remoteSeq = message.seq;
      remoteInput = { rod: message.rod, axis: message.axis };
      lastRemoteInputAt = performance.now();
      break;
    case "kick":
      // Somente o host simula; o cliente apenas encaminha a intenção.
      if (session.isHost) {
        performKickForPlayer(match, match.aiPlayer, message.rod, message.power, message.direction);
      }
      break;
    case "ability_activate":
      if (session.isHost) {
        tryActivateAbility(match, message.abilityId, match.nowMs, match.aiPlayer);
      }
      break;
    case "snapshot":
      // O canal de estado é não-ordenado: ignora snapshots atrasados.
      if (!session.isHost && message.snapshot.tick > lastAppliedTick) {
        lastAppliedTick = message.snapshot.tick;
        receivedSnapshots += 1;
        // Guarda a posição visual atual e aplica o estado lógico do snapshot.
        // A posição é interpolada no loop para não "teletransportar" a bola.
        const prevBall = { x: match.ball.pos.x, y: match.ball.pos.y };
        const prevRods = new Map(
          match.rods.map((rod) => [rodKey(rod.side, rod.id), rod.yOffset] as [string, number]),
        );
        applySnapshot(match, message.snapshot);
        match.ball.pos = prevBall;
        for (const rod of match.rods) {
          const prev = prevRods.get(rodKey(rod.side, rod.id));
          if (prev !== undefined) rod.yOffset = prev;
        }
        visualTarget = {
          ball: { x: message.snapshot.ball.pos.x, y: message.snapshot.ball.pos.y },
          rods: new Map(
            message.snapshot.rods.map((rod) => [rodKey(rod.side, rod.id), rod.yOffset] as [string, number]),
          ),
        };
      }
      break;
    case "ping":
      online?.send({ type: "pong", t: message.t });
      break;
    case "pong":
      rttMs = performance.now() - message.t;
      break;
    case "hello":
      break;
  }
}

function bindUi(): void {
  const markers = document.getElementById("ability-markers");
  if (!markers) return;

  const getMarkerId = (e: Event): string | null =>
    (e.target as HTMLElement).closest<HTMLElement>("[data-preview-ability]")?.getAttribute("data-preview-ability") ?? null;

  markers.addEventListener("pointerover", (e) => {
    const id = getMarkerId(e);
    if (id) previewAbilityId = id;
  });
  markers.addEventListener("pointerout", (e) => {
    if (getMarkerId(e)) previewAbilityId = null;
  });
  markers.addEventListener("focusin", (e) => {
    const id = getMarkerId(e);
    if (id) previewAbilityId = id;
  });
  markers.addEventListener("focusout", () => {
    previewAbilityId = null;
  });
  markers.addEventListener("click", (e) => {
    const id = getMarkerId(e);
    if (id && match && !session) tryActivateAbility(match, id, performance.now());
  });
}

/** Congela a partida e abre o painel de resultado com ações de navegação. */
function showResultIfFinished(): void {
  if (!match || match.phase !== "finished" || matchResultShown || !match.winner) return;
  matchResultShown = true;
  const won = match.winner === match.localPlayer.side;
  flow.showMatchResult({
    won,
    winnerName: won ? match.localPlayer.name : match.aiPlayer.name,
    scoreLeft: match.score.left,
    scoreRight: match.score.right,
    stage: match.stage,
    online: !!session,
  });
  // Desenha o frame final antes de travar o loop.
  renderAll();
}

function renderAll(): void {
  if (!match) return;
  const canvas = document.getElementById("game") as HTMLCanvasElement | null;
  if (canvas) {
    renderField(
      canvas, match, input.selectedRod, previewAbilityId,
      input.charging?.direction ?? null, match.localPlayer.side,
    );
  }
  renderHud(match, { previewAbilityId });
}

function syncRodCharge(now: number): void {
  if (!match) return;
  for (const rod of match.rods) {
    if (rod.side !== match.localPlayer.side) continue;
    rod.charge = rod.id === input.selectedRod && input.charging
      ? Math.min(1, (now - input.charging.startedAtMs) / 700)
      : 0;
  }
}

/** Interpola o estado recebido do host para eliminar os saltos a 15/30 Hz. */
function smoothVisuals(deltaMs: number): void {
  if (!match || !visualTarget) return;
  const k = Math.min(1, deltaMs / 55);
  const target = visualTarget.ball;
  const ball = match.ball.pos;
  if (Math.hypot(target.x - ball.x, target.y - ball.y) > match.field.width * 0.45) {
    // Gol/reset: a bola realmente teleportou, não interpola.
    ball.x = target.x;
    ball.y = target.y;
  } else {
    ball.x += (target.x - ball.x) * k;
    ball.y += (target.y - ball.y) * k;
  }
  for (const rod of match.rods) {
    const targetY = visualTarget.rods.get(rodKey(rod.side, rod.id));
    if (targetY === undefined) continue;
    const diff = targetY - rod.yOffset;
    if (rod.side === match.localPlayer.side) {
      // A própria barra é prevista localmente: só corrige erros grandes para
      // não criar "rubber band" a cada snapshot.
      if (Math.abs(diff) > 45) rod.yOffset += diff * Math.min(1, deltaMs / 120);
    } else {
      rod.yOffset += diff * k;
    }
  }
}

function updateControlHints(scheme: ControlScheme): void {
  const hints: Record<string, string> = {
    rods: scheme.rods.map((b) => keyLabel(b.key)).join(" "),
    move: `${keyLabel(scheme.moveUp)} ${keyLabel(scheme.moveDown)}`,
    kickForward: keyLabel(scheme.kickForward),
    kickBackward: keyLabel(scheme.kickBackward),
    abilities: scheme.abilitySlots.map((code) => keyLabel(code)).join("-"),
  };
  for (const [key, label] of Object.entries(hints)) {
    const el = document.querySelector<HTMLElement>(`[data-hint="${key}"]`);
    if (el) el.textContent = label;
  }
}

let detachInput: (() => void) | null = null;
function attachControls(scheme: ControlScheme): void {
  detachInput?.();
  updateControlHints(scheme);
  detachInput = attachInputListeners(window, scheme, input, {
    shouldHandle: () => flow.isPlaying(),
    onRodSelect: () => sendInput(),
    onMoveAxis: () => sendInput(),
    onKickRelease: (direction, power) => {
      if (!match) return;
      if (session && !session.isHost) {
        online?.send({ type: "kick", rod: input.selectedRod, power, direction });
        return;
      }
      performKick(match, input.selectedRod, power, direction);
    },
    onAbilitySlot: (slotIndex) => {
      if (!match) return;
      const abilityId = getEquippedAbilityIds(match)[slotIndex];
      if (!abilityId) return;
      if (session && !session.isHost) {
        online?.send({ type: "ability_activate", abilityId });
        return;
      }
      tryActivateAbility(match, abilityId, performance.now());
    },
  });
}

attachControls(flow.getControlScheme());

bindUi();
Object.assign(window, {
  input,
  HEROES,
  flow,
  netStats: () => ({ rttMs: rttMs === null ? null : Math.round(rttMs), receivedSnapshots, isHost: session?.isHost ?? null }),
});
Object.defineProperty(window, "match", { get: () => match, configurable: true });
Object.defineProperty(window, "online", { get: () => online, configurable: true });

let last = performance.now();
let wasPlaying = false;
function loop(now: number): void {
  const deltaMs = Math.min(100, now - last);
  last = now;

  const playing = !!match && flow.isPlaying();
  // Ao pausar, solta as teclas seguradas para não mover a barra ao voltar.
  if (wasPlaying && !playing && match) {
    input.moveAxis = 0;
    input.charging = null;
    for (const rod of match.rods) rod.charge = 0;
    sendInput();
  }
  wasPlaying = playing;

  if (playing && match) {
    if (session?.isHost) {
      // Sem heartbeat por 250 ms, considera o input remoto solto. Isso evita
      // que a barra do adversário continue andando se o keyup se perder.
      if (performance.now() - lastRemoteInputAt > 250) remoteInput.axis = 0;
      if (input.moveAxis !== 0) movePlayerRod(match, input.selectedRod, input.moveAxis, deltaMs);
      moveRodForPlayer(match, match.aiPlayer, remoteInput.rod, remoteInput.axis, deltaMs);
    } else if (session) {
      // Predição local: a barra responde na hora; o snapshot corrige depois.
      if (input.moveAxis !== 0) movePlayerRod(match, input.selectedRod, input.moveAxis, deltaMs);
      if (now - lastHeartbeatAt >= 50) {
        lastHeartbeatAt = now;
        sendInput();
      }
      if (now - lastPingAt >= 1000) {
        lastPingAt = now;
        online?.send({ type: "ping", t: performance.now() });
      }
      smoothVisuals(deltaMs);
    } else if (input.moveAxis !== 0) {
      movePlayerRod(match, input.selectedRod, input.moveAxis, deltaMs);
    }

    syncRodCharge(now);

    if (!session || session.isHost) {
      updateMatch(match, deltaMs, now);
    }

    if (session?.isHost && now - lastSnapshotAt >= 33) {
      lastSnapshotAt = now;
      online?.send({ type: "snapshot", snapshot: serializeMatch(match) });
    }

    renderAll();
    showResultIfFinished();
  }
  requestAnimationFrame(loop);
}

void flow.start();
requestAnimationFrame(loop);
