import type { AbilitySystemState } from "../game/ability-system";
import type { BallState } from "../game/ball";
import type { ComboState, ElasticState, KickEffect, MatchScore, MatchToast, MatchState } from "../game/match";
import type { RodState } from "../game/rods";

/**
 * Estado mínimo que o host transmite para o cliente.
 * Heróis, campo e ajustes de IA não viajam: as duas pontas constroem a partida
 * localmente a partir do matchmaking e só recebem o que muda a cada frame.
 */
export interface MatchSnapshot {
  tick: number;
  nowMs: number;
  phase: MatchState["phase"];
  winner: MatchState["winner"];
  ball: BallState;
  score: MatchScore;
  stage: number;
  noGoalMs: number;
  heat: number;
  rods: RodState[];
  effects: KickEffect[];
  toast: MatchToast | null;
  combo: ComboState | null;
  elastic: ElasticState | null;
  lockMovementUntilMs: number;
  reboteCounterAvailable: boolean;
  copiedAbilityId: string | null;
  localSystem: AbilitySystemState;
  remoteSystem: AbilitySystemState;
  log: string[];
}

function cloneSystem(system: AbilitySystemState): AbilitySystemState {
  return {
    ...system,
    bar: { ...system.bar, segments: [...system.bar.segments] },
    abilities: Object.fromEntries(
      Object.entries(system.abilities).map(([id, runtime]) => [id, { ...runtime }]),
    ),
  };
}

export function serializeMatch(match: MatchState): MatchSnapshot {
  return {
    tick: match.tick,
    nowMs: match.nowMs,
    phase: match.phase,
    winner: match.winner,
    ball: { ...match.ball, pos: { ...match.ball.pos }, vel: { ...match.ball.vel } },
    score: { ...match.score },
    stage: match.stage,
    noGoalMs: match.noGoalMs,
    heat: match.heat,
    rods: match.rods.map((rod) => ({ ...rod })),
    effects: match.effects.map((effect) => ({ ...effect })),
    toast: match.toast ? { ...match.toast } : null,
    combo: match.combo ? { ...match.combo } : null,
    elastic: match.elastic ? { ...match.elastic } : null,
    lockMovementUntilMs: match.lockMovementUntilMs,
    reboteCounterAvailable: match.reboteCounterAvailable,
    copiedAbilityId: match.copiedAbilityId,
    localSystem: cloneSystem(match.localPlayer.abilitySystem),
    remoteSystem: cloneSystem(match.aiPlayer.abilitySystem),
    // O histórico cresce durante a partida; mandar tudo a cada snapshot
    // infla o pacote e prejudica a latência.
    log: match.log.slice(-8),
  };
}

export function applySnapshot(match: MatchState, snapshot: MatchSnapshot): void {
  match.tick = snapshot.tick;
  match.nowMs = snapshot.nowMs;
  match.phase = snapshot.phase;
  match.winner = snapshot.winner;
  match.ball = { ...snapshot.ball, pos: { ...snapshot.ball.pos }, vel: { ...snapshot.ball.vel } };
  match.score = { ...snapshot.score };
  match.stage = snapshot.stage;
  match.noGoalMs = snapshot.noGoalMs;
  match.heat = snapshot.heat;
  match.rods = snapshot.rods.map((rod) => ({ ...rod }));
  match.effects = snapshot.effects.map((effect) => ({ ...effect }));
  match.toast = snapshot.toast ? { ...snapshot.toast } : null;
  match.combo = snapshot.combo ? { ...snapshot.combo } : null;
  match.elastic = snapshot.elastic ? { ...snapshot.elastic } : null;
  match.lockMovementUntilMs = snapshot.lockMovementUntilMs;
  match.reboteCounterAvailable = snapshot.reboteCounterAvailable;
  match.copiedAbilityId = snapshot.copiedAbilityId;
  // O host é sempre o lado esquerdo. No cliente, o jogador local é o direito,
  // então os sistemas precisam ser mapeados por lado, não por "local/remoto".
  const leftSystem = snapshot.localSystem;
  const rightSystem = snapshot.remoteSystem;
  match.localPlayer.abilitySystem = cloneSystem(
    match.localPlayer.side === "left" ? leftSystem : rightSystem,
  );
  match.aiPlayer.abilitySystem = cloneSystem(
    match.aiPlayer.side === "left" ? leftSystem : rightSystem,
  );
  match.log = [...snapshot.log];
}
