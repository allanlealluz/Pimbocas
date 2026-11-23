import { ABILITIES, ABILITY_COLORS, getAbility, getAbilityPowerMult } from "../domain/abilities";
import { getHero, listHeroes } from "../domain/heroes";
import { ROLE_IDENTITY_BONUS } from "../domain/roles";
import { STAT_REFERENCE } from "../domain/stats";
import type { AbilityDefinition, ChargeEvent, HeroDefinition, RodId } from "../domain/types";
import {
  activateAbility,
  applyCharge,
  consumeArmedAbility,
  createAbilitySystem,
  getAbilityModifiers,
  isAbilityActiveAt,
  NEUTRAL_MODIFIERS,
  tickAbilitySystem,
  type AbilityModifiers,
  type AbilitySystemState,
  type ActivateAbilityResult,
} from "./ability-system";
import { clearBallEffects, createBall, DEFAULT_FIELD, resetBall, updateBall, type BallState, type FieldConfig } from "./ball";
import {
  clampRodOffset,
  createAllRods,
  getFigureContacts,
  getFootVelocityX,
  getRodFiguresY,
  triggerRodKick,
  updateRod,
  type RodState,
} from "./rods";

export interface PlayerMatchState {
  id: string;
  name: string;
  /** Lado defendido: o local ataca para a direita, a IA para a esquerda. */
  side: "left" | "right";
  hero: HeroDefinition;
  abilitySystem: AbilitySystemState;
}

export interface MatchScore { left: number; right: number; }

export type EffectKind = "kick" | "ability" | "block" | "goal" | "miss";

export interface KickEffect {
  x: number;
  y: number;
  ageMs: number;
  lifeMs: number;
  power: number;
  color: string;
  kind: EffectKind;
  label?: string;
}

export interface MatchToast {
  title: string;
  detail: string;
  color: string;
  ageMs: number;
  lifeMs: number;
}

/** Sequência de rechutes do Combo Breaker. */
export interface ComboState {
  rodId: RodId;
  remainingKicks: number;
  nextAtMs: number;
  power: number;
  direction: 1 | -1;
  intervalMs: number;
}

/** Órbita do Elástico: a bola fica presa ao boneco e sai depois de 1-5 s. */
export interface ElasticState {
  rodId: RodId;
  figureIndex: number;
  centerX: number;
  figureY: number;
  angle: number;
  angularSpeed: number;
  radius: number;
  remainingMs: number;
  totalMs: number;
  exitOffsetY: number;
  releaseSpeed: number;
  color: string;
}

/** Os Gêmeos: passe coreografado de uma barra para outra, com a bola alinhada. */
export interface ChoreographyState {
  abilityId: string;
  ownerSide: "left" | "right";
  rodId: RodId;
  targetRodId: RodId;
  targetFigureIndex: number;
  direction: 1 | -1;
  startX: number;
  targetX: number;
  targetY: number;
  elapsedMs: number;
  travelMs: number;
  /** Força já multiplicada pelo bônus da coreografia. */
  power: number;
  speedMult: number;
  color: string;
}

/** Churrasqueiro: o meio-campo gira e devolve a bola na direção de origem. */
export interface RotationState {
  ownerSide: "left" | "right";
  rodId: RodId;
  remainingMs: number;
  totalMs: number;
  angle: number;
  angularSpeed: number;
  kickUsed: boolean;
  color: string;
}

export type AiDifficulty = "facil" | "medio" | "dificil";

const AI_TUNING: Record<AiDifficulty, {
  chaseSpeed: number;
  kickChance: number;
  /** Chance por segundo de tentar ativar uma habilidade equipada. */
  abilityRate: number;
  /** Herói base usado pelo adversário (copiado com id próprio). */
  heroId: string;
}> = {
  facil: { chaseSpeed: 150, kickChance: 0.02, abilityRate: 0.12, heroId: "kenji" },
  medio: { chaseSpeed: 220, kickChance: 0.055, abilityRate: 0.25, heroId: "jhonas" },
  dificil: { chaseSpeed: 300, kickChance: 0.1, abilityRate: 0.4, heroId: "gulias" },
};

/**
 * Habilidades que a IA sabe usar sozinhas. Ficam de fora as que dependem de
 * estado global do jogador local (copia, roletada, rebote, combo, elástico).
 */
const AI_ABILITY_POOL = new Set([
  "chute_diagonal",
  "chute_relampago",
  "forca_bruta",
  "bloqueio_pesado",
  "mao_grande",
  "zaga_magnetica",
  "chute_goleiro",
  "leitura_de_jogo",
  "cruzador_estelar",
  "chute_fantasma",
]);

export interface MatchState {
  /** `solo` roda a IA localmente; `online` recebe os inputs do adversário pela rede. */
  mode: "solo" | "online";
  /** No online, o host simula e transmite snapshots; o cliente apenas aplica. */
  isHost: boolean;
  phase: "lobby" | "playing" | "paused" | "finished";
  tick: number;
  nowMs: number;
  field: FieldConfig;
  ball: BallState;
  score: MatchScore;
  /** Fase/stack atual: sobe quando o placar chega a 10 sem diferença de 3. */
  stage: number;
  /** Tempo desde o último gol; dispara o calor da arena. */
  noGoalMs: number;
  /** 0-1: intensidade do fogo na mesa e da bola. */
  heat: number;
  winner: "left" | "right" | null;
  rods: RodState[];
  effects: KickEffect[];
  toast: MatchToast | null;
  combo: ComboState | null;
  elastic: ElasticState | null;
  choreography: ChoreographyState | null;
  rotation: RotationState | null;
  /** Roletada: até quando o manete do jogador fica travado. */
  lockMovementUntilMs: number;
  /** Rebote: o contra-ataque ainda está disponível nesta ativação. */
  reboteCounterAvailable: boolean;
  /** Última habilidade emprestada pela Cópia (para a HUD). */
  copiedAbilityId: string | null;
  localPlayer: PlayerMatchState;
  aiPlayer: PlayerMatchState;
  ai: {
    difficulty: AiDifficulty;
    chaseSpeed: number;
    kickChance: number;
    abilityRate: number;
    /** Próxima janela em que a IA pode decidir usar uma habilidade. */
    abilityCheckAtMs: number;
  };
  log: string[];
}

const PHYSICS_STEP_MS = 6;
const BASE_RESTITUTION = 0.62;

/** Chute 100 deve doer: sem teto baixo, o stat realmente aumenta a velocidade. */
const KICK_POWER_PER_POINT = 0.013;
const MAX_KICK_POWER = 2.8;
const MAX_TRIGGER_POWER = 1.8;

function statScale(value: number, perPoint = 0.012): number {
  return 1 + (value - STAT_REFERENCE) * perPoint;
}

/**
 * Poder das habilidades por quantidade equipada: quem tem menos habilidades
 * compensa com efeitos mais fortes (2 > 3 > 4).
 */
function applyAbilityPower(mods: AbilityModifiers, power: number): void {
  if (power === 1) return;
  const scale = (value: number): number => 1 + (value - 1) * power;
  mods.ballSpeedMult = scale(mods.ballSpeedMult);
  mods.kickPowerMult = scale(mods.kickPowerMult);
  mods.reboundMult = scale(mods.reboundMult);
  mods.rodSpeedMult = scale(mods.rodSpeedMult);
  mods.ballDrain = scale(mods.ballDrain);
  mods.reachBonus *= power;
  mods.guardBonus *= power;
  mods.trajectoryKeep = Math.min(1, mods.trajectoryKeep * power);
  mods.spinRetention = Math.max(0.05, 1 - (1 - mods.spinRetention) * power);
  mods.ghostDelayMs *= power;
  mods.ghostStrength *= power;
  mods.comboKicks = Math.max(1, Math.round(mods.comboKicks * power));
  mods.comboIntervalMs = Math.max(70, mods.comboIntervalMs / power);
  mods.bigHandRadius *= power;
  mods.goalkeeperKickSpeedMult = scale(mods.goalkeeperKickSpeedMult);
  mods.magnetRadius *= power;
  mods.magnetStrength *= power;
  mods.lightningSpeedMult = scale(mods.lightningSpeedMult);
  mods.elasticMinMs *= power;
  mods.elasticMaxMs *= power;
  mods.bruteSpeedMult = scale(mods.bruteSpeedMult);
  mods.bruteBounce = 0.82 + (mods.bruteBounce - 0.82) * power;
  mods.roletadaSpeedMult = scale(mods.roletadaSpeedMult);
  mods.lockMovementMs *= power;
  mods.rebotePower = scale(mods.rebotePower);
  mods.choreographySpeed *= power;
  mods.choreographyPower = scale(mods.choreographyPower);
  mods.rotationSpeed *= power;
  mods.explosionSpeedMult = scale(mods.explosionSpeedMult);
  mods.explosionCompressMs *= power;
  mods.explosionHopMs *= power;
  mods.explosionHopDistance *= power;
  mods.explosionHopHeight *= power;
  mods.explosionSpin *= power;
  mods.explosionRollingMs *= power;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function createDemoMatch(heroId: string, difficulty: AiDifficulty = "medio"): MatchState {
  const hero = getHero(heroId);
  const field = { ...DEFAULT_FIELD };
  const ball = createBall(field);
  resetBall(ball, field, 1);
  const tuning = AI_TUNING[difficulty];
  const aiHeroBase = getHero(tuning.heroId);
  const aiHero: HeroDefinition = {
    ...aiHeroBase,
    id: `ai_${aiHeroBase.id}`,
    name: `IA · ${aiHeroBase.name}`,
  };
  return {
    mode: "solo",
    isHost: true,
    phase: "playing",
    tick: 0,
    nowMs: performance.now(),
    field,
    ball,
    score: { left: 0, right: 0 },
    stage: 1,
    noGoalMs: 0,
    heat: 0,
    winner: null,
    rods: createAllRods(),
    effects: [],
    toast: null,
    combo: null,
    elastic: null,
    choreography: null,
    rotation: null,
    lockMovementUntilMs: 0,
    reboteCounterAvailable: false,
    copiedAbilityId: null,
    localPlayer: {
      id: "local",
      name: "Você",
      side: "left",
      hero,
      abilitySystem: createAbilitySystem(hero),
    },
    aiPlayer: {
      id: "ai",
      name: aiHero.name,
      side: "right",
      hero: aiHero,
      abilitySystem: createAbilitySystem(aiHero),
    },
    ai: {
      difficulty,
      chaseSpeed: tuning.chaseSpeed,
      kickChance: tuning.kickChance,
      abilityRate: tuning.abilityRate,
      abilityCheckAtMs: 0,
    },
    log: [
      `Partida iniciada com ${hero.name} (${hero.role}) contra ${aiHero.name}.`,
      `${aiHero.name}: ${aiHero.abilities.length} habilidade(s) pronta(s) para usar.`,
    ],
  };
}

/** Partida 1v1: o adversário ocupa o lado direito no lugar da IA. */
export function createOnlineMatch(
  localHeroId: string,
  remoteHeroId: string,
  localName: string,
  remoteName: string,
  isHost: boolean,
  localSide: "left" | "right" = "left",
): MatchState {
  const localHero = getHero(localHeroId);
  const remoteHero = getHero(remoteHeroId);
  const field = { ...DEFAULT_FIELD };
  const ball = createBall(field);
  resetBall(ball, field, 1);

  return {
    mode: "online",
    isHost,
    phase: "playing",
    tick: 0,
    nowMs: performance.now(),
    field,
    ball,
    score: { left: 0, right: 0 },
    stage: 1,
    noGoalMs: 0,
    heat: 0,
    winner: null,
    rods: createAllRods(),
    effects: [],
    toast: null,
    combo: null,
    elastic: null,
    choreography: null,
    rotation: null,
    lockMovementUntilMs: 0,
    reboteCounterAvailable: false,
    copiedAbilityId: null,
    localPlayer: {
      id: "local",
      name: localName || "Você",
      side: localSide,
      hero: localHero,
      abilitySystem: createAbilitySystem(localHero),
    },
    aiPlayer: {
      id: "remote",
      name: remoteName || "Adversário",
      side: localSide === "left" ? "right" : "left",
      hero: remoteHero,
      abilitySystem: createAbilitySystem(remoteHero),
    },
    ai: { difficulty: "medio", chaseSpeed: 220, kickChance: 0, abilityRate: 0, abilityCheckAtMs: 0 },
    log: [`Online 1v1: ${localName || "Você"} contra ${remoteName || "Adversário"}.`],
  };
}

/**
 * Combina os atributos do personagem com as habilidades ativas.
 * Referência = 40 (média dentro do orçamento de 200 pontos).
 *  - controle: menos rebote, bola "cola" no pé;
 *  - velocidade: a barra se move mais rápido;
 *  - defesa: drena a velocidade da bola no contato;
 *  - goleiro: alcance/pegada extras só na barra do goleiro.
 */
export function getPlayerModifiers(match: MatchState, player: PlayerMatchState, rodId: RodId): AbilityModifiers {
  const mods = getAbilityModifiers(player.abilitySystem, rodId, match.nowMs);
  applyAbilityPower(mods, getAbilityPowerMult(player.hero.abilities.length));
  const stats = player.hero.stats;

  mods.kickPowerMult *= statScale(stats.kickPower, KICK_POWER_PER_POINT);
  mods.rodSpeedMult *= statScale(stats.rodSpeed);

  const controlRebound = Math.max(0.25, 2 - statScale(stats.ballControl));
  mods.reboundMult = Math.max(0.2, mods.reboundMult * controlRebound);
  mods.reachBonus += Math.max(0, (stats.ballControl - STAT_REFERENCE) * 0.12);

  mods.ballDrain = clamp(1 - (stats.defense - STAT_REFERENCE) * 0.006, 0.5, 1.25);

  if (rodId === "goleiro") {
    const goalieReach = Math.max(0, (stats.goalkeeping - STAT_REFERENCE) * 0.3);
    mods.reachBonus += goalieReach;
    mods.guardBonus += goalieReach * 0.25;
    // Pegada de goleiro: segura a bola em vez de devolver o rebote.
    mods.ballDrain = clamp(
      mods.ballDrain * clamp(1 - (stats.goalkeeping - STAT_REFERENCE) * 0.005, 0.6, 1.2),
      0.45,
      1.25,
    );
  } else if (rodId === "defesa") {
    mods.guardBonus += Math.max(0, (stats.defense - STAT_REFERENCE) / 10);
  }

  // Cada habilidade nova responde ao atributo que comanda seu efeito.
  if (mods.bigHand) {
    mods.bigHandRadius *= clamp(statScale(stats.goalkeeping, 0.01), 0.65, 1.8);
  }
  if (mods.goalkeeperKick) {
    mods.goalkeeperKickSpeedMult *= clamp(statScale(stats.kickPower, 0.008), 0.8, 1.6);
  }
  if (mods.magnetic) {
    const magScale = clamp(statScale(stats.defense, 0.012), 0.6, 1.9);
    mods.magnetRadius *= magScale;
    mods.magnetStrength *= magScale;
  }
  if (mods.lightning) {
    mods.lightningSpeedMult *= clamp(statScale(stats.kickPower, 0.01), 0.7, 1.9);
  }
  if (mods.elastic) {
    const controlScale = clamp(statScale(stats.ballControl, 0.012), 0.75, 1.9);
    mods.elasticMinMs = Math.max(1000, Math.round(mods.elasticMinMs * controlScale));
    mods.elasticMaxMs = Math.max(
      mods.elasticMinMs,
      Math.min(7000, Math.round(mods.elasticMaxMs * controlScale)),
    );
  }
  if (mods.brute) {
    mods.bruteSpeedMult *= clamp(statScale(stats.kickPower, 0.01), 0.7, 1.9);
    mods.bruteBounce = Math.min(
      0.99,
      mods.bruteBounce + Math.max(0, stats.kickPower - STAT_REFERENCE) * 0.0008,
    );
  }
  if (mods.roletada) {
    mods.roletadaSpeedMult *= clamp(statScale(stats.kickPower, 0.01), 0.7, 1.9);
  }
  if (mods.rebote) {
    mods.rebotePower *= clamp(statScale(stats.kickPower, 0.01), 0.7, 1.9);
  }
  if (mods.choreography) {
    mods.choreographyPower *= clamp(statScale(stats.ballControl, 0.008), 0.8, 1.5);
  }
  if (mods.rotation) {
    mods.rotationSpeed *= clamp(statScale(stats.ballControl, 0.01), 0.75, 1.6);
  }
  if (mods.explosion) {
    const blastScale = clamp(statScale(stats.kickPower, 0.01), 0.7, 1.9);
    mods.explosionSpeedMult *= blastScale;
    mods.explosionSpin *= blastScale;
  }

  // Identidade da role: um empurrão pequeno e fixo, aplicado depois dos stats e
  // do bônus por quantidade de habilidades. `ballDrain` menor = mais drenagem.
  switch (player.hero.role) {
    case "ofensivo":
      mods.kickPowerMult *= 1 + ROLE_IDENTITY_BONUS;
      break;
    case "defensivo":
      mods.ballDrain *= 1 - ROLE_IDENTITY_BONUS;
      break;
    case "coringa":
      mods.rodSpeedMult *= 1 + ROLE_IDENTITY_BONUS;
      break;
  }

  return mods;
}

/** Atalho usado pelo render e pelo input: sempre o jogador local. */
export function getHeroModifiers(match: MatchState, rodId: RodId): AbilityModifiers {
  return getPlayerModifiers(match, match.localPlayer, rodId);
}

export function pushLog(match: MatchState, message: string): void {
  const time = new Date().toLocaleTimeString("pt-BR", { hour12: false });
  match.log.unshift(`[${time}] ${message}`);
  match.log = match.log.slice(0, 8);
}

/**
 * Slots equipados: o slot 1 é sempre a habilidade mais barata e o último, a
 * mais cara, seguindo a mesma ordem de baixo para cima do termômetro. A
 * habilidade emprestada pela Cópia fica por último, como slot extra.
 */
export function getEquippedAbilityIds(
  match: MatchState,
  player: PlayerMatchState = match.localPlayer,
): string[] {
  const ids = [...player.hero.abilities].sort(
    (a, b) => (getAbility(a)?.cost ?? 0) - (getAbility(b)?.cost ?? 0),
  );
  for (const runtime of Object.values(player.abilitySystem.abilities)) {
    if (runtime.borrowed && !ids.includes(runtime.abilityId)) ids.push(runtime.abilityId);
  }
  return ids;
}

function showToast(match: MatchState, title: string, detail: string, color: string): void {
  match.toast = { title, detail, color, ageMs: 0, lifeMs: 1900 };
}

const WIN_BY_POINTS = 3;
const STAGE_SCORE = 10;
const HEAT_BASE_MS = 60_000;

/** A cada stack a mesa esquenta mais rápido (60s → 30s → 20s...). */
function heatThresholdMs(match: MatchState): number {
  return Math.max(20_000, HEAT_BASE_MS / Math.max(1, match.stage));
}

function updateHeat(match: MatchState, deltaMs: number): void {
  match.noGoalMs += deltaMs;
  const threshold = heatThresholdMs(match);
  const heat = clamp((match.noGoalMs - threshold) / threshold, 0, 1);
  if (heat > 0 && match.heat === 0) {
    showToast(match, "MESA EM CHAMAS", "A bola ficou mais rápida e quicante!", "#ff7b3d");
    pushLog(match, "A arena pegou fogo: velocidade e quicada da bola aumentaram.");
  }
  match.heat = heat;
  match.ball.heat = heat;
}

function finishMatch(match: MatchState, side: "left" | "right"): void {
  match.phase = "finished";
  match.winner = side;
  const winnerName = side === "left" ? match.localPlayer.name : match.aiPlayer.name;
  showToast(match, "FIM DE JOGO", `${winnerName} venceu por ${WIN_BY_POINTS} pontos!`, side === "left" ? "#8affc1" : "#ff9f87");
  pushLog(match, `${winnerName} venceu no stack ${match.stage}.`);
}

function advanceStage(match: MatchState): void {
  match.stage += 1;
  match.score.left = 0;
  match.score.right = 0;
  match.noGoalMs = 0;
  match.heat = 0;
  match.ball.heat = 0;
  match.ai.chaseSpeed = Math.round(match.ai.chaseSpeed * 1.08);
  match.ai.kickChance = Math.min(0.2, match.ai.kickChance * 1.12);
  showToast(match, `STACK ${match.stage}`, "Placar zerado. A mesa esquenta mais rápido!", "#ffb04a");
  pushLog(match, `Stack ${match.stage}: placar zerado e mesa mais quente.`);
}

/** Vitória por 3 pontos; ao chegar em 10 sem essa margem, sobe de stack. */
function registerGoalProgress(match: MatchState, side: "left" | "right"): void {
  const diff = Math.abs(match.score.left - match.score.right);
  if (diff >= WIN_BY_POINTS) {
    finishMatch(match, side);
    return;
  }
  if (Math.max(match.score.left, match.score.right) >= STAGE_SCORE) {
    advanceStage(match);
  }
}

function addEffect(
  match: MatchState,
  x: number,
  y: number,
  power: number,
  color: string,
  kind: EffectKind = "kick",
  label?: string,
): void {
  match.effects.push({ x, y, ageMs: 0, lifeMs: kind === "ability" ? 750 : 450, power, color, kind, label });
  if (match.effects.length > 30) match.effects.shift();
}

function getPlayerRod(
  match: MatchState,
  rodId: RodId,
  player: PlayerMatchState = match.localPlayer,
): RodState | undefined {
  return match.rods.find((r) => r.side === player.side && r.id === rodId);
}

function getPlayerBySide(match: MatchState, side: "left" | "right"): PlayerMatchState {
  return side === "left" ? match.localPlayer : match.aiPlayer;
}

function getAIRods(match: MatchState): RodState[] {
  return match.rods.filter((r) => r.side === "right");
}

function nearestFigureIndex(rod: RodState, fieldHeight: number, y: number): number {
  const figures = getRodFiguresY(rod, fieldHeight);
  let index = 0;
  let best = Infinity;
  for (let i = 0; i < figures.length; i += 1) {
    const dist = Math.abs(figures[i]! - y);
    if (dist < best) {
      best = dist;
      index = i;
    }
  }
  return index;
}

function stripChoreography(mods: AbilityModifiers): AbilityModifiers {
  return {
    ...mods,
    choreography: false,
    choreographyTarget: null,
    activeIds: mods.activeIds.filter((id) => id !== "chute_duplo" && id !== "sequencia_toques"),
  };
}

/**
 * Cruzador Estelar: qualquer defesa (contato ou chute da IA) devolve a bola
 * para o rumo original, mantendo parte da velocidade e o giro.
 */
function applyStellarDefense(match: MatchState): boolean {
  const ball = match.ball;
  if (ball.guideRemainingMs <= 0 || ball.guideKeep <= 0) return false;

  const len = Math.hypot(ball.guideVx, ball.guideVy) || 1;
  // Restaura a velocidade do chute original: a defesa tira apenas 15%.
  const speed = ball.guideSpeed > 0
    ? ball.guideSpeed * 0.85
    : Math.hypot(ball.vel.x, ball.vel.y) * 0.9;
  ball.vel.x = ball.vel.x * (1 - ball.guideKeep) + (ball.guideVx / len) * speed * ball.guideKeep;
  ball.vel.y = ball.vel.y * (1 - ball.guideKeep) + (ball.guideVy / len) * speed * ball.guideKeep;
  ball.spin = ball.guideSpin * 0.85;
  ball.stuckMs = 0;
  addEffect(match, ball.pos.x, ball.pos.y, 0.7, ABILITY_COLORS.cruzador_estelar!, "ability", "CRUZADOR");
  return true;
}

/** Zaga Magnética: atrai a bola para os bonecos mesmo sem encostar neles. */
function applyMagneticDefense(match: MatchState, player: PlayerMatchState, deltaMs: number): void {
  if (match.elastic || match.choreography) return;
  const ball = match.ball;
  if (ball.explosionCompressMs > 0 || ball.explosionHopRemainingMs > 0) return;
  const dt = deltaMs / 1000;

  for (const rodId of ["goleiro", "defesa"] as RodId[]) {
    const rod = getPlayerRod(match, rodId, player);
    if (!rod) continue;
    const mods = getPlayerModifiers(match, player, rodId);
    if (!mods.magnetic || mods.magnetRadius <= 0) continue;

    const centerX = rod.xRatio * match.field.width;
    for (const figureY of getRodFiguresY(rod, match.field.height)) {
      const dx = centerX - ball.pos.x;
      const dy = figureY - ball.pos.y;
      const dist = Math.hypot(dx, dy);
      if (dist > mods.magnetRadius || dist < 1) continue;

      const falloff = 1 - dist / mods.magnetRadius;
      const accel = mods.magnetStrength * falloff * dt;
      ball.vel.x += (dx / dist) * accel;
      ball.vel.y += (dy / dist) * accel;
      // Pequeno desvio tangencial: muda a direção mesmo quando não há pegada.
      ball.vel.y += Math.sign(dy || 1) * accel * 0.08;
      ball.spin += (dx > 0 ? 1 : -1) * falloff * dt * 2;
    }
  }
}

/** Elástico: prende a bola em órbita ao redor do atacante. */
function startElastic(match: MatchState, rod: RodState, mods: AbilityModifiers): void {
  const field = match.field;
  const figuresY = getRodFiguresY(rod, field.height);
  let figureIndex = 0;
  for (let i = 1; i < figuresY.length; i += 1) {
    if (Math.abs(figuresY[i]! - match.ball.pos.y) < Math.abs(figuresY[figureIndex]! - match.ball.pos.y)) {
      figureIndex = i;
    }
  }

  const minMs = Math.max(1000, mods.elasticMinMs || 1000);
  const maxMs = Math.max(minMs, Math.min(7000, mods.elasticMaxMs || 5000));
  const totalMs = minMs + Math.random() * (maxMs - minMs);
  const centerX = rod.xRatio * field.width;
  const figureY = figuresY[figureIndex] ?? field.height / 2;
  const angle = Math.atan2(match.ball.pos.y - figureY, match.ball.pos.x - centerX);

  match.elastic = {
    rodId: rod.id,
    figureIndex,
    centerX,
    figureY,
    angle,
    angularSpeed: (Math.random() < 0.5 ? -1 : 1) * (6 + Math.random() * 3),
    radius: 34 + Math.random() * 12,
    remainingMs: totalMs,
    totalMs,
    exitOffsetY: 12 + Math.random() * 14,
    releaseSpeed: Math.min(1500, 420 + Math.min(1.8, mods.kickPowerMult) * 520),
    color: ABILITY_COLORS.elastico ?? "#ff8ad8",
  };

  const ball = match.ball;
  clearBallEffects(ball);
  ball.vel.x = 0;
  ball.vel.y = 0;
  ball.spin = 0;
  ball.stuckMs = 0;
  ball.pos.x = centerX + Math.cos(angle) * match.elastic.radius;
  ball.pos.y = clamp(
    figureY + Math.sin(angle) * match.elastic.radius,
    ball.radius + 4,
    field.height - ball.radius - 4,
  );
  addEffect(match, ball.pos.x, ball.pos.y, 0.8, match.elastic.color, "ability", "ELÁSTICO");
}

/** Avança a órbita e, no tempo sorteado, devolve a bola já atacando o gol. */
function updateElastic(match: MatchState, deltaMs: number): void {
  const elastic = match.elastic;
  if (!elastic) return;

  const rod = getPlayerRod(match, elastic.rodId);
  if (!rod) {
    match.elastic = null;
    return;
  }

  const ball = match.ball;
  const field = match.field;
  elastic.remainingMs = Math.max(0, elastic.remainingMs - deltaMs);
  elastic.angle += elastic.angularSpeed * (deltaMs / 1000);
  elastic.centerX = rod.xRatio * field.width;
  elastic.figureY = getRodFiguresY(rod, field.height)[elastic.figureIndex] ?? field.height / 2;

  const orbitY = clamp(
    elastic.figureY + Math.sin(elastic.angle) * elastic.radius,
    ball.radius + 4,
    field.height - ball.radius - 4,
  );
  ball.pos.x = elastic.centerX + Math.cos(elastic.angle) * elastic.radius;
  ball.pos.y = orbitY;
  ball.vel.x = 0;
  ball.vel.y = 0;
  ball.spin = elastic.angularSpeed * 1.5;
  ball.roll += Math.abs(elastic.angularSpeed) * (deltaMs / 1000) * 2;
  ball.stuckMs = 0;

  if (elastic.remainingMs > 0) return;

  clearBallEffects(ball);
  ball.pos.y = clamp(
    ball.pos.y + elastic.exitOffsetY * (Math.sin(elastic.angle) >= 0 ? 1 : -1),
    ball.radius + 6,
    field.height - ball.radius - 6,
  );
  ball.vel.x = elastic.releaseSpeed;
  ball.vel.y = (Math.random() - 0.5) * 180;
  ball.spin = (Math.random() - 0.5) * 14;
  ball.stuckMs = 0;
  addEffect(match, ball.pos.x, ball.pos.y, 0.9, elastic.color, "ability", "ELÁSTICO");
  match.elastic = null;
}

/**
 * Os Gêmeos: a bola não é chutada direto. Ela encosta no boneco, fica alinhada
 * a um boneco da barra de destino e desliza devagar até lá; o arremate final
 * sai do pé que recebeu o passe.
 */
function startChoreography(
  match: MatchState,
  rod: RodState,
  effectivePower: number,
  direction: 1 | -1,
  mods: AbilityModifiers,
): boolean {
  const targetRodId = mods.choreographyTarget;
  if (!targetRodId) return false;
  const player = getPlayerBySide(match, rod.side);
  const targetRod = getPlayerRod(match, targetRodId, player);
  if (!targetRod) return false;

  const ball = match.ball;
  const abilityId = mods.activeIds.find((id) => id === "chute_duplo" || id === "sequencia_toques")
    ?? (targetRodId === "ataque" ? "chute_duplo" : "sequencia_toques");
  const color = ABILITY_COLORS[abilityId] ?? "#ffd166";
  const targetFigureIndex = nearestFigureIndex(targetRod, match.field.height, ball.pos.y);
  const targetX = targetRod.xRatio * match.field.width + direction * 26;
  const startX = ball.pos.x;
  const distance = Math.abs(targetX - startX);
  const travelMs = clamp((distance / Math.max(120, mods.choreographySpeed)) * 1000, 260, 1500);
  const targetY = getRodFiguresY(targetRod, match.field.height)[targetFigureIndex] ?? match.field.height / 2;

  clearBallEffects(ball);
  ball.vel.x = 0;
  ball.vel.y = 0;
  ball.spin = 0;
  ball.stuckMs = 0;
  ball.pos.y = targetY;
  rod.lastContactMs = match.nowMs;

  match.choreography = {
    abilityId,
    ownerSide: player.side,
    rodId: rod.id,
    targetRodId,
    targetFigureIndex,
    direction,
    startX,
    targetX,
    targetY,
    elapsedMs: 0,
    travelMs,
    power: effectivePower * mods.choreographyPower,
    speedMult: mods.ballSpeedMult,
    color,
  };
  addEffect(match, ball.pos.x, ball.pos.y, 0.8, color, "ability", getAbility(abilityId).name.toUpperCase());
  return true;
}

/** Avança o passe alinhado e devolve a bola no pé da barra de destino. */
function updateChoreography(match: MatchState, deltaMs: number): void {
  const state = match.choreography;
  if (!state) return;
  const player = getPlayerBySide(match, state.ownerSide);
  const targetRod = getPlayerRod(match, state.targetRodId, player);
  if (!targetRod) {
    match.choreography = null;
    return;
  }

  const ball = match.ball;
  state.elapsedMs = Math.min(state.travelMs, state.elapsedMs + deltaMs);
  state.targetX = targetRod.xRatio * match.field.width + state.direction * 26;
  state.targetY = getRodFiguresY(targetRod, match.field.height)[state.targetFigureIndex] ?? match.field.height / 2;
  const t = state.travelMs > 0 ? state.elapsedMs / state.travelMs : 1;

  ball.pos.x = state.startX + (state.targetX - state.startX) * t;
  ball.pos.y = state.targetY;
  ball.vel.x = 0;
  ball.vel.y = 0;
  ball.spin = 0;
  ball.roll += (deltaMs / 1000) * 2;
  ball.stuckMs = 0;

  if (state.elapsedMs < state.travelMs) return;

  const mods = stripChoreography(getPlayerModifiers(match, player, state.targetRodId));
  // Mantém o bônus da coreografia mesmo se a janela de ativação terminou no trajeto.
  mods.ballSpeedMult = Math.max(mods.ballSpeedMult, state.speedMult);
  triggerRodKick(targetRod, Math.min(MAX_TRIGGER_POWER, state.power));
  addEffect(match, ball.pos.x, ball.pos.y, 1, state.color, "ability", "ARREMATE");
  match.choreography = null;
  applyKickToBall(match, targetRod, state.power, state.direction, mods, AUTO_REACH_X, AUTO_REACH_Y);
}

/** Churrasqueiro: anima o meio girando e devolve a primeira bola que chegar. */
function updateRotation(match: MatchState, deltaMs: number): void {
  const state = match.rotation;
  if (!state) return;
  state.remainingMs = Math.max(0, state.remainingMs - deltaMs);
  state.angle += state.angularSpeed * (deltaMs / 1000);

  const player = getPlayerBySide(match, state.ownerSide);
  const rod = getPlayerRod(match, state.rodId, player);
  if (rod) {
    rod.kickAngle = Math.sin(state.angle) * 1.25;
    rod.kickVel = Math.cos(state.angle) * state.angularSpeed * 1.25;
  }

  if (state.remainingMs === 0) {
    match.rotation = null;
    return;
  }
  if (state.kickUsed || !rod || match.choreography || match.elastic) return;
  const ball = match.ball;
  if (ball.explosionCompressMs > 0 || ball.explosionHopRemainingMs > 0) return;
  if (!ballNearRodFigure(match, rod, AUTO_REACH_X, AUTO_REACH_Y).hit) return;
  if (Math.hypot(ball.vel.x, ball.vel.y) < 60) return;

  // O meio girando devolve para onde a bola veio: frente ou trás conforme a chegada.
  const attackDir: 1 | -1 = player.side === "left" ? 1 : -1;
  const incoming = Math.sign(ball.vel.x) || (attackDir === 1 ? -1 : 1);
  const direction: 1 | -1 = incoming === attackDir ? (attackDir === 1 ? -1 : 1) : attackDir;
  const mods = getPlayerModifiers(match, player, state.rodId);
  const effectivePower = Math.min(MAX_KICK_POWER, 0.9 * mods.kickPowerMult);
  triggerRodKick(rod, Math.min(MAX_TRIGGER_POWER, effectivePower));
  const hit = applyKickToBall(match, rod, effectivePower, direction, mods, AUTO_REACH_X, AUTO_REACH_Y);
  if (!hit) return;

  state.kickUsed = true;
  addEffect(match, ball.pos.x, ball.pos.y, 1, state.color, "ability", "ROTAÇÃO");
  const prefix = player.side === "right" ? "IA · " : "";
  showToast(match, `${prefix}ROTAÇÃO!`, "O meio girou e devolveu a bola.", state.color);
  pushLog(match, `${prefix}Meio girando devolveu a bola para ${direction === 1 ? "frente" : "trás"}.`);
  registerAbilityCharge(match, player, { type: "attack_kick", power: effectivePower });
}

/** Rebote: o boneco devolve um chute forte assim que a bola encosta nele. */
function triggerReboteCounter(
  match: MatchState,
  player: PlayerMatchState,
  rod: RodState,
  figureY: number,
  mods: AbilityModifiers,
): void {
  const ball = match.ball;
  const color = ABILITY_COLORS.rebote ?? "#7cffb2";
  const power = Math.min(2.4, mods.rebotePower);
  const dir = player.side === "left" ? 1 : -1;

  clearBallEffects(ball);
  ball.pos.x = rod.xRatio * match.field.width + dir * 30;
  ball.pos.y = clamp(
    figureY + 12,
    ball.radius + 4,
    match.field.height - ball.radius - 4,
  );
  ball.vel.x = dir * (260 + power * 760) * mods.ballSpeedMult * 0.95;
  ball.vel.y = clamp((match.field.height / 2 - ball.pos.y) * 0.55, -220, 220) + (Math.random() - 0.5) * 90;
  ball.spin = (Math.random() - 0.5) * 6;
  ball.stuckMs = 0;
  ball.untouchedGoalKick = false;

  rod.lastContactMs = match.nowMs;
  triggerRodKick(rod, Math.min(MAX_TRIGGER_POWER, power));
  match.reboteCounterAvailable = false;
  addEffect(match, ball.pos.x, ball.pos.y, Math.min(1, power / 1.8), color, "ability", "REBOTE");
  const prefix = player.side === "right" ? "IA · " : "";
  showToast(match, `${prefix}REBOTE!`, `Contra-ataque de ${player.hero.name}!`, color);
  registerAbilityCharge(match, player, { type: "attack_kick", power });
}

/**
 * Contato real da bola com o corpo e a bota do boneco.
 * Usa dois círculos por boneco, impulsos com restituição e a velocidade da
 * bota durante o giro do chute — o contato acontece no pé, não no centro da barra.
 */
function resolveBallFigureCollisions(match: MatchState): void {
  const ball = match.ball;
  let contactsThisStep = 0;

  for (const rod of match.rods) {
    // Logo após um chute, a bola ainda está dentro do círculo de contato do
    // próprio boneco. Ignorar esse contato evita que o chute seja desviado.
    if (match.nowMs - rod.lastContactMs < 120) continue;

    const player = rod.side === "left" ? match.localPlayer : match.aiPlayer;
    const mods = getPlayerModifiers(match, player, rod.id);
    // Mão Grande aumenta só a área do goleiro, além do bônus normal de guarda.
    const guardBonus = mods.guardBonus
      + (rod.id === "goleiro" && mods.bigHand ? mods.bigHandRadius : 0);
    const figuresY = getRodFiguresY(rod, match.field.height);

    for (const figureY of figuresY) {
      for (const contact of getFigureContacts(rod, figureY, match.field.width, guardBonus)) {
        let dx = ball.pos.x - contact.x;
        let dy = ball.pos.y - contact.y;
        let dist = Math.hypot(dx, dy);
        const minDist = ball.radius + contact.r;
        if (dist >= minDist) continue;

        if (dist < 0.0001) {
          dx = rod.side === "left" ? 1 : -1;
          dy = 0;
          dist = 1;
        }
        const nx = dx / dist;
        const ny = dy / dist;
        const incomingSpeed = Math.hypot(ball.vel.x, ball.vel.y);
        ball.pos.x += nx * (minDist - dist);
        ball.pos.y += ny * (minDist - dist);
        // Qualquer toque real quebra a condição de gol "limpo" do Chute de Goleiro.
        ball.untouchedGoalKick = false;

        const contactVx = contact.isFoot ? getFootVelocityX(rod) : 0;
        const contactVy = rod.vy;
        const rvx = ball.vel.x - contactVx;
        const rvy = ball.vel.y - contactVy;
        const vn = rvx * nx + rvy * ny;

        // Rebote: se o boneco está no aguardo, a bola chega e já volta atacando.
        // O estado do contra-ataque é do jogador local; a IA não usa esta habilidade.
        if (player.side === "left" && vn < 0 && mods.rebote && match.reboteCounterAvailable) {
          triggerReboteCounter(match, player, rod, figureY, mods);
          return;
        }

        if (vn < 0) {
          const restitution = BASE_RESTITUTION * mods.reboundMult;
          const impulse = -(1 + restitution) * vn / 1.25;
          ball.vel.x += impulse * nx;
          ball.vel.y += impulse * ny;

          const tx = -ny;
          const ty = nx;
          const tangential = rvx * tx + rvy * ty;
          ball.vel.x -= tangential * tx * 0.06;
          ball.vel.y -= tangential * ty * 0.06;
          ball.spin += tangential * 0.012;

          // Defesa (e pegada de goleiro) drenam a velocidade da bola no contato.
          ball.vel.x *= mods.ballDrain;
          ball.vel.y *= mods.ballDrain;
        }

        if (match.nowMs - rod.lastContactMs > 220) {
          rod.lastContactMs = match.nowMs;

          // Cruzador Estelar: a defesa tira velocidade, mas não o rumo do chute.
          if (rod.side === "right") applyStellarDefense(match);

          for (const abilityId of getEquippedAbilityIds(match, player)) {
            const ability = getAbility(abilityId);
            if (ability.trigger === "next_defense" && ability.allowedRods.includes(rod.id)) {
              tryConsumeArmedAbility(match, abilityId, match.nowMs, player);
            }
          }
          const impact = Math.min(2, incomingSpeed / 900);
          registerAbilityCharge(match, player, {
            type: rod.id === "goleiro" ? "defense_save" : "defense_block",
            impact,
          });
        }

        contactsThisStep += 1;
        break; // um contato por boneco por subpasso
      }
      if (contactsThisStep >= 3) break;
    }
    if (contactsThisStep >= 3) break;
  }
}

function ballNearRodFigure(match: MatchState, rod: RodState, reachX = 40, reachY = 44): { hit: boolean; y: number } {
  const rodX = rod.xRatio * match.field.width;
  const dx = Math.abs(match.ball.pos.x - rodX);
  if (dx > reachX) return { hit: false, y: match.ball.pos.y };
  const ys = getRodFiguresY(rod, match.field.height);
  let bestY = ys[0] ?? match.field.height / 2;
  let bestDist = Infinity;
  for (const y of ys) {
    const d = Math.abs(match.ball.pos.y - y);
    if (d < bestDist) { bestDist = d; bestY = y; }
  }
  return { hit: bestDist < reachY, y: bestY };
}

function applyKickToBall(
  match: MatchState,
  rod: RodState,
  effectivePower: number,
  direction?: 1 | -1,
  mods: AbilityModifiers = NEUTRAL_MODIFIERS,
  reachX = 40,
  reachY = 44,
): boolean {
  const { hit, y } = ballNearRodFigure(match, rod, reachX + mods.reachBonus, reachY + mods.reachBonus);
  if (!hit) return false;

  const dir = direction ?? (rod.side === "left" ? 1 : -1);
  const power = Math.min(MAX_KICK_POWER, effectivePower);
  const visualPower = Math.min(1, power / 1.8);
  // Os Gêmeos assumem a bola antes do chute comum: o passe alinhado termina
  // com um arremate automático na barra de destino.
  if (mods.choreography && startChoreography(match, rod, power, dir, mods)) return true;
  let speed = (260 + power * 760) * mods.ballSpeedMult;
  if (mods.goalkeeperKick) speed *= mods.goalkeeperKickSpeedMult;
  if (mods.brute) speed *= mods.bruteSpeedMult;
  const center = match.field.height / 2;
  const diagSign = match.ball.pos.y < center ? -1 : 1;
  // Chutar com a barra em movimento dá uma leve inclinação: subiu, a bola sai
  // subindo; desceu, sai descendo. O limite evita que um puxão vire bomba lateral.
  const swingY = clamp(rod.vy * 0.45, -220, 220);
  let vertical = ((match.ball.pos.y - y) / 40) * 180 + swingY;
  if (mods.diagonal || mods.stellar) {
    vertical += diagSign * (140 + power * 120) * (mods.stellar ? 1.35 : 1);
  }

  const ball = match.ball;
  // Um chute da IA não deve apagar o efeito do Cruzador: a defesa preserva o rumo.
  const guided = rod.side === "right" && ball.guideRemainingMs > 0 && ball.guideKeep > 0;
  if (!guided) clearBallEffects(ball);
  rod.lastContactMs = match.nowMs;
  ball.vel.x = speed * dir;
  ball.vel.y = vertical + (Math.random() - 0.5) * 70;
  ball.spin += mods.stellar ? dir * 20 : mods.rotation ? dir * 14 : mods.diagonal ? dir * 9 : (Math.random() - 0.5) * 3;
  ball.stuckMs = 0;

  // Cruzador: guarda o rumo e um giro que demora a sumir.
  if (mods.stellar) {
    ball.guideVx = ball.vel.x;
    ball.guideVy = vertical;
    ball.guideRemainingMs = 1000;
    ball.guideKeep = mods.trajectoryKeep;
    ball.guideSpin = ball.spin;
    ball.guideSpeed = Math.hypot(ball.vel.x, ball.vel.y);
    ball.spinRetention = mods.spinRetention;
  }

  // Fantasma: sai na diagonal oposta e, após a finta, volta com giro forte.
  if (mods.phantom) {
    ball.vel.y = -diagSign * (200 + power * 140) * mods.ghostStrength + (Math.random() - 0.5) * 40;
    ball.spin = -diagSign * 12 * mods.ghostStrength;
    ball.phantomSpin = diagSign * 16 * mods.ghostStrength;
    ball.phantomRemainingMs = mods.ghostDelayMs;
  }

  // Chute de Goleiro: mira a área do gol e vale 2 pontos até qualquer toque.
  if (mods.goalkeeperKick) {
    ball.vel.y = clamp((center - ball.pos.y) * 0.9, -90, 90) + (Math.random() - 0.5) * 24;
    ball.untouchedGoalKick = true;
  }

  // Chute Relâmpago: mira a quina e a física devolve para a área do gol.
  if (mods.lightning) {
    const targetY = ball.pos.y < center ? ball.radius + 2 : match.field.height - ball.radius - 2;
    const targetX = dir === 1 ? match.field.width - ball.radius - 30 : ball.radius + 30;
    const dx = targetX - ball.pos.x;
    const dy = targetY - ball.pos.y;
    const len = Math.hypot(dx, dy) || 1;
    ball.vel.x = (dx / len) * speed;
    ball.vel.y = (dy / len) * speed;
    ball.spin += dir * 6;
    ball.lightningBounce = true;
    ball.lightningSpeedMult = mods.lightningSpeedMult;
    ball.lightningDir = dir;
  }

  // Força Bruta: bomba sem direção definida, com giro e quicadas elásticas.
  if (mods.brute) {
    ball.lightningBounce = false;
    ball.lightningSpeedMult = 1;
    ball.vel.x = speed * dir * (0.8 + Math.random() * 0.4);
    ball.vel.y = (Math.random() - 0.5) * 900;
    ball.spin = (Math.random() - 0.5) * 30;
    ball.bruteMs = 1800;
    ball.bruteBounce = mods.bruteBounce;
  }

  // Roletada: bomba sem controle e o jogador perde o manete por um instante.
  if (mods.roletada) {
    ball.lightningBounce = false;
    ball.lightningSpeedMult = 1;
    ball.bruteMs = 0;
    ball.bruteBounce = 0.82;
    ball.vel.x = speed * dir * (0.92 + Math.random() * 0.16) * mods.roletadaSpeedMult;
    ball.vel.y = (Math.random() - 0.5) * (620 + power * 180);
    ball.spin = (Math.random() - 0.5) * 26;
    ball.untouchedGoalKick = false;
    rod.lastContactMs = match.nowMs;
    match.lockMovementUntilMs = match.nowMs + mods.lockMovementMs;
    showToast(
      match,
      "ROLETADA",
      `Bomba solta · manete travado por ${(mods.lockMovementMs / 1000).toFixed(1)}s`,
      ABILITY_COLORS.roletada ?? "#b28cff",
    );
  }

  // Explosão: a bola comprime, pula um pouco à frente e só depois sai rodando.
  if (mods.explosion) {
    const blastSpeed = speed * mods.explosionSpeedMult;
    ball.lightningBounce = false;
    ball.lightningSpeedMult = 1;
    ball.bruteMs = 0;
    ball.bruteBounce = 0.82;
    ball.vel.x = 0;
    ball.vel.y = 0;
    ball.spin = 0;
    ball.untouchedGoalKick = false;
    ball.stuckMs = 0;
    ball.explosionCompressMs = mods.explosionCompressMs;
    ball.explosionHopRemainingMs = mods.explosionHopMs;
    ball.explosionHopTotalMs = mods.explosionHopMs;
    ball.explosionHopHeight = mods.explosionHopHeight;
    ball.explosionHopStartX = ball.pos.x;
    ball.explosionHopStartY = ball.pos.y;
    ball.explosionHopTargetX = clamp(
      ball.pos.x + dir * mods.explosionHopDistance,
      ball.radius + 2,
      match.field.width - ball.radius - 2,
    );
    ball.explosionHopTargetY = clamp(
      ball.pos.y + (center - ball.pos.y) * 0.12,
      ball.radius + 2,
      match.field.height - ball.radius - 2,
    );
    ball.explosionSpin = dir * mods.explosionSpin;
    ball.explosionSpeed = blastSpeed;
    ball.explosionDir = dir;
    ball.explosionRollingMs = mods.explosionRollingMs;
  }

  const effectId = mods.stellar ? "cruzador_estelar"
    : mods.phantom ? "chute_fantasma"
    : mods.elastic ? "elastico"
    : mods.explosion ? "explosao"
    : mods.rotation ? "rotacionar"
    : mods.goalkeeperKick ? "chute_goleiro"
    : mods.roletada ? "roletada"
    : mods.rebote ? "rebote"
    : mods.lightning ? "chute_relampago"
    : mods.brute ? "forca_bruta"
    : mods.combo ? "combo_breaker"
    : mods.activeIds.find((id) => id !== "copia") ?? mods.activeIds[0];
  if (effectId) {
    addEffect(match, ball.pos.x, ball.pos.y, visualPower, ABILITY_COLORS[effectId] ?? "#ffb347", "ability", getAbility(effectId).name);
  } else {
    addEffect(match, ball.pos.x, ball.pos.y, visualPower, rod.side === "left" ? "#7fd6ff" : "#ff9f87", "kick");
  }
  if (guided) applyStellarDefense(match);
  return true;
}

export function updateMatch(match: MatchState, deltaMs: number, nowMs: number): void {
  if (match.phase !== "playing") return;
  match.tick += 1;
  match.nowMs = nowMs;
  tickAbilitySystem(match.localPlayer.abilitySystem, deltaMs, nowMs);
  tickAbilitySystem(match.aiPlayer.abilitySystem, deltaMs, nowMs);
  if (match.reboteCounterAvailable && !isAbilityActiveAt(match.localPlayer.abilitySystem, "rebote", nowMs)) {
    match.reboteCounterAvailable = false;
  }
  updateHeat(match, deltaMs);

  for (const rod of match.rods) updateRod(rod, deltaMs, match.field.height);
  for (const fx of match.effects) fx.ageMs += deltaMs;
  match.effects = match.effects.filter((fx) => fx.ageMs < fx.lifeMs);
  if (match.toast) {
    match.toast.ageMs += deltaMs;
    if (match.toast.ageMs >= match.toast.lifeMs) match.toast = null;
  }

  if (match.mode === "solo") {
    updateAIAbilities(match, deltaMs);
    updateAI(match, deltaMs);
  }
  updateCombo(match);
  updateRotation(match, deltaMs);

  // Subpassos curtos evitam tunneling em chutes fortes.
  let remaining = deltaMs;
  let goal: "left" | "right" | null = null;
  let cleanGoalKick = false;
  while (remaining > 0) {
    const step = Math.min(PHYSICS_STEP_MS, remaining);
    remaining -= step;

    // Enquanto o Elástico ou a coreografia está ativo, a bola está "no pé".
    if (match.elastic) {
      updateElastic(match, step);
      continue;
    }
    if (match.choreography) {
      updateChoreography(match, step);
      continue;
    }

    applyMagneticDefense(match, match.localPlayer, step);
    applyMagneticDefense(match, match.aiPlayer, step);
    const wasPhantom = match.ball.phantomRemainingMs > 0;
    const result = updateBall(match.ball, step, match.field);
    if (wasPhantom && result.phantomEnded) {
      addEffect(match, match.ball.pos.x, match.ball.pos.y, 0.8, ABILITY_COLORS.chute_fantasma!, "ability", "FANTASMA");
    }
    if (result.lightningBounced) {
      addEffect(
        match,
        match.ball.pos.x,
        match.ball.pos.y,
        0.9,
        ABILITY_COLORS.chute_relampago ?? "#f6ff6b",
        "ability",
        "RELÂMPAGO",
      );
    }
    if (result.explosionLaunched) {
      addEffect(
        match,
        match.ball.pos.x,
        match.ball.pos.y,
        1,
        ABILITY_COLORS.explosao ?? "#ff5d3b",
        "ability",
        "EXPLOSÃO",
      );
    }
    if (match.ball.explosionCompressMs > 0 || match.ball.explosionHopRemainingMs > 0) continue;
    resolveBallFigureCollisions(match);
    if (result.goal) {
      goal = result.goal;
      cleanGoalKick = (result.goal === "right" || result.goal === "left") && match.ball.untouchedGoalKick;
      break;
    }
  }

  if (goal === "left") {
    const color = cleanGoalKick ? ABILITY_COLORS.chute_goleiro ?? "#ff9f43" : "#ff9f87";
    match.score.right += cleanGoalKick ? 2 : 1;
    addEffect(
      match,
      30,
      match.field.height / 2,
      1,
      color,
      "goal",
      cleanGoalKick ? "GOL DE GOLEIRO +2" : "GOL",
    );
    if (cleanGoalKick) {
      showToast(match, `GOL DE GOLEIRO · ${match.aiPlayer.name}`, "Chute limpo: 2 pontos!", color);
      pushLog(match, `${match.aiPlayer.name} fez um gol de goleiro limpo: +2 pontos.`);
    }
    match.noGoalMs = 0;
    match.heat = 0;
    match.ball.heat = 0;
    match.combo = null;
    match.elastic = null;
    match.choreography = null;
    match.rotation = null;
    match.lockMovementUntilMs = 0;
    match.reboteCounterAvailable = false;
    registerGoalProgress(match, "right");
    resetBall(match.ball, match.field, -1);
  } else if (goal === "right") {
    const color = cleanGoalKick ? ABILITY_COLORS.chute_goleiro ?? "#ff9f43" : "#7fd6ff";
    match.score.left += cleanGoalKick ? 2 : 1;
    addEffect(
      match,
      match.field.width - 30,
      match.field.height / 2,
      1,
      color,
      "goal",
      cleanGoalKick ? "GOL DE GOLEIRO +2" : "GOL",
    );
    if (cleanGoalKick) {
      showToast(match, "GOL DE GOLEIRO", "Chute limpo: 2 pontos!", color);
      pushLog(match, "Gol de goleiro limpo: +2 pontos.");
    }
    match.noGoalMs = 0;
    match.heat = 0;
    match.ball.heat = 0;
    match.combo = null;
    match.elastic = null;
    match.choreography = null;
    match.rotation = null;
    match.lockMovementUntilMs = 0;
    match.reboteCounterAvailable = false;
    registerGoalProgress(match, "left");
    resetBall(match.ball, match.field, 1);
  }
}

function updateAI(match: MatchState, deltaMs: number): void {
  const dt = deltaMs / 1000;
  const ball = match.ball;
  const player = match.aiPlayer;
  for (const rod of getAIRods(match)) {
    const rodX = rod.xRatio * match.field.width;
    const dx = ball.pos.x - rodX;
    const relevant = dx < 160 && dx > -220;
    const targetY = relevant ? ball.pos.y - match.field.height / 2 : 0;
    const diff = targetY - rod.yOffset;
    const speed = relevant ? match.ai.chaseSpeed : 80;
    rod.yOffset += Math.sign(diff) * Math.min(Math.abs(diff), speed * dt);
    clampRodOffset(rod, match.field.height);

    const near = ballNearRodFigure(match, rod, 40, 44);
    const movingToward = ball.vel.x > -40;
    if (near.hit && movingToward && Math.random() < match.ai.kickChance) {
      const power = 0.45 + Math.random() * 0.45;

      // Consome as habilidades armadas antes de calcular o chute, igual ao local.
      for (const abilityId of getEquippedAbilityIds(match, player)) {
        const ability = getAbility(abilityId);
        if (ability.trigger === "next_kick" && ability.allowedRods.includes(rod.id)) {
          tryConsumeArmedAbility(match, abilityId, match.nowMs, player);
        }
      }

      const mods = getPlayerModifiers(match, player, rod.id);
      const effectivePower = Math.min(MAX_KICK_POWER, power * mods.kickPowerMult);
      triggerRodKick(rod, Math.min(MAX_TRIGGER_POWER, effectivePower));
      const hit = applyKickToBall(match, rod, effectivePower, undefined, mods, 40, 44);
      if (hit) registerAbilityCharge(match, player, { type: "attack_kick", power: effectivePower });
    }
  }
}

/**
 * Oportunidade da habilidade para a IA (0 = guardar energia).
 * A IA defende à direita: bola vindo com vel.x > 0 é ameaça ao próprio gol.
 * Chutes só fazem sentido com a bola no pé de uma barra válida; defesas só
 * quando a bola está chegando. Isso acaba com o disparo aleatório.
 */
function aiAbilityOpportunity(
  match: MatchState,
  player: PlayerMatchState,
  ability: AbilityDefinition,
): number {
  const ball = match.ball;
  const width = match.field.width;
  const inOwnHalf = ball.pos.x > width * 0.5;
  const incoming = ball.vel.x > 60;
  const threat = inOwnHalf && incoming;
  const speed = Math.hypot(ball.vel.x, ball.vel.y);
  const near = findAutoRod(match, ability, player) !== null;

  switch (ability.trigger) {
    case "next_kick":
      if (!near) return 0;
      // Bola parada ou chegando devagar é o momento do chute armado.
      return 3 + (speed < 500 ? 1 : 0) + (threat ? 1 : 0);
    case "next_defense":
      if (!incoming || !near) return 0;
      return 3 + (threat ? 2 : 0);
    case "timed":
      if (ability.role === "defensivo") {
        if (!threat && !near) return 0;
        return 2 + (threat ? 2 : 0);
      }
      if (near) return 2;
      return threat ? 1 : 0;
    default:
      return 0;
  }
}

/** IA: escolhe e ativa sozinha a habilidade mais oportuna do próprio herói. */
function updateAIAbilities(match: MatchState, _deltaMs: number): void {
  const player = match.aiPlayer;
  const system = player.abilitySystem;
  const now = match.nowMs;

  const candidates = Object.values(system.abilities)
    .filter((runtime) => {
      if (!AI_ABILITY_POOL.has(runtime.abilityId)) return false;
      if (runtime.cooldownRemainingMs > 0) return false;
      if (runtime.armedUntilMs !== null) return false;
      if (runtime.activeUntilMs !== null && now < runtime.activeUntilMs) return false;
      return system.bar.current >= getAbility(runtime.abilityId).cost;
    })
    .map((runtime) => {
      const ability = getAbility(runtime.abilityId);
      return { runtime, ability, score: aiAbilityOpportunity(match, player, ability) };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.ability.cost - b.ability.cost);
  if (candidates.length === 0) return;

  // Janela de reação: a IA não fica sorteado a cada frame, e sim avalia a cada
  // intervalo curto. Dificuldade maior => reação mais rápida.
  if (now < match.ai.abilityCheckAtMs) return;
  const baseMs = clamp(1000 / (0.5 + match.ai.abilityRate), 400, 1600);
  match.ai.abilityCheckAtMs = now + baseMs * (0.85 + Math.random() * 0.3);

  tryActivateAbility(match, candidates[0]!.runtime.abilityId, now, player);
}

/** Rechutes automáticos do Combo Breaker: o jogador "pega" a bola no pé. */
function updateCombo(match: MatchState): void {
  const combo = match.combo;
  if (!combo || match.elastic || match.choreography || match.nowMs < combo.nextAtMs) return;
  if (match.ball.explosionCompressMs > 0 || match.ball.explosionHopRemainingMs > 0) return;

  const rod = getPlayerRod(match, combo.rodId);
  if (!rod) {
    match.combo = null;
    return;
  }

  const figuresY = getRodFiguresY(rod, match.field.height);
  let targetY = figuresY[0] ?? match.field.height / 2;
  for (const y of figuresY) {
    if (Math.abs(y - match.ball.pos.y) < Math.abs(targetY - match.ball.pos.y)) targetY = y;
  }

  const ball = match.ball;
  clearBallEffects(ball);
  ball.pos.x = rod.xRatio * match.field.width + combo.direction * 24;
  ball.pos.y = targetY + 12;
  ball.vel.x = 0;
  ball.vel.y = 0;
  ball.spin = 0;
  ball.stuckMs = 0;

  const mods = getHeroModifiers(match, combo.rodId);
  const kickNumber = 2 + (mods.comboKicks - combo.remainingKicks);
  const power = Math.min(1.35, combo.power + 0.08 * (kickNumber - 2));
  triggerRodKick(rod, power);

  // Não reinicia o combo aqui: só a chamada do jogador (performKick) faz isso.
  const kickMods: AbilityModifiers = {
    ...mods,
    combo: false,
    activeIds: mods.activeIds.filter((id) => id !== "combo_breaker"),
  };
  const effectivePower = Math.min(MAX_KICK_POWER, power * kickMods.kickPowerMult);
  applyKickToBall(match, rod, effectivePower, combo.direction, kickMods);
  addEffect(match, ball.pos.x, ball.pos.y, power, ABILITY_COLORS.combo_breaker!, "ability", `COMBO x${kickNumber}`);

  combo.remainingKicks -= 1;
  if (combo.remainingKicks <= 0) {
    match.combo = null;
  } else {
    combo.nextAtMs = match.nowMs + combo.intervalMs;
  }
}

/** Carga de qualquer jogador: o prefixo distingue a energia da IA no log. */
export function registerAbilityCharge(match: MatchState, player: PlayerMatchState, event: ChargeEvent): void {
  const gained = applyCharge(player.abilitySystem, event);
  if (gained > 0) {
    const prefix = player.side === "right" ? "IA · " : "";
    pushLog(match, `${prefix}+${gained.toFixed(1)} energia (${event.type}).`);
  }
}

export function registerMatchEvent(match: MatchState, event: ChargeEvent): void {
  registerAbilityCharge(match, match.localPlayer, event);
}

/** Alcance generoso do "pega a bola": a habilidade não exige chute manual. */
const AUTO_REACH_X = 110;
const AUTO_REACH_Y = 78;

/** Encontra a barra válida mais próxima da bola para um auto-disparo. */
function findAutoRod(
  match: MatchState,
  ability: AbilityDefinition,
  player: PlayerMatchState = match.localPlayer,
): RodState | null {
  let best: RodState | null = null;
  let bestDist = Infinity;
  for (const rodId of ability.allowedRods) {
    const rod = getPlayerRod(match, rodId, player);
    if (!rod) continue;
    const near = ballNearRodFigure(match, rod, AUTO_REACH_X, AUTO_REACH_Y);
    if (!near.hit) continue;
    const rodX = rod.xRatio * match.field.width;
    const dist = Math.abs(match.ball.pos.x - rodX) + Math.abs(match.ball.pos.y - near.y);
    if (dist < bestDist) {
      bestDist = dist;
      best = rod;
    }
  }
  return best;
}

/**
 * Habilidade game-changing: se a bola está perto da condição dela, ela mesma
 * pega a bola e executa o chute/defesa. Se não está, fica armada para o próximo
 * chute manual como antes.
 */
function tryAutoExecuteAbility(
  match: MatchState,
  ability: AbilityDefinition,
  player: PlayerMatchState = match.localPlayer,
): boolean {
  const rod = findAutoRod(match, ability, player);
  if (!rod) return false;
  const color = ABILITY_COLORS[ability.id] ?? "#ffb347";
  const dir = player.side === "left" ? 1 : -1;

  if (ability.trigger === "next_kick") {
    // performKickForPlayer consome a armação, calcula a força e registra a carga.
    performKickForPlayer(match, player, rod.id, 1, dir, { x: AUTO_REACH_X, y: AUTO_REACH_Y });
    return true;
  }

  if (ability.trigger === "next_defense") {
    for (const abilityId of getEquippedAbilityIds(match, player)) {
      const other = getAbility(abilityId);
      if (other.trigger === "next_defense" && other.allowedRods.includes(rod.id)) {
        tryConsumeArmedAbility(match, abilityId, match.nowMs, player);
      }
    }
    const ball = match.ball;
    ball.vel.x *= 0.1;
    ball.vel.y *= 0.25;
    ball.spin *= 0.2;
    ball.stuckMs = 0;
    triggerRodKick(rod, 0.7);
    rod.lastContactMs = match.nowMs;
    addEffect(match, ball.pos.x, ball.pos.y, 1, color, "ability", ability.name.toUpperCase());
    registerAbilityCharge(match, player, { type: "defense_save", impact: 1.2 });
    return true;
  }

  return false;
}

/**
 * Habilidades que não podem ser copiadas: dependem de estado global criado no
 * herói original (rebote, roletada, elástico, combo) ou de outro empréstimo.
 * As novas habilidades podem ser copiadas: coreografia e rotação guardam o lado
 * dono no próprio estado, e a Explosão vive na bola.
 */
const COPY_BLOCKED = new Set(["copia", "roletada", "rebote", "combo_breaker", "elastico"]);

/**
 * A Cópia rouba uma habilidade de alguém ali na mesa: primeiro do adversário,
 * depois de qualquer outro herói do elenco. Nunca sortia do próprio herói.
 */
function pickCopyTarget(match: MatchState, player: PlayerMatchState = match.localPlayer): string | null {
  const equipped = new Set(player.hero.abilities);
  const opponents = player === match.localPlayer ? match.aiPlayer : match.localPlayer;

  const usable = (hero: HeroDefinition) => hero.abilities.filter((id) =>
    ABILITIES[id] && !COPY_BLOCKED.has(id) && !equipped.has(id));

  // Prioridade absoluta: o adversário. É a habilidade "de alguém ali" que o
  // jogador espera ver quando pressiona Cópia.
  const fromOpponent = usable(opponents.hero);
  if (fromOpponent.length > 0) {
    return fromOpponent[Math.floor(Math.random() * fromOpponent.length)]!;
  }

  // Fallback: outro herói qualquer do catálogo (o Paulo sempre tem opções).
  const others = listHeroes()
    .filter((hero) => hero.id !== player.hero.id)
    .flatMap(usable);
  return others[Math.floor(Math.random() * others.length)] ?? null;
}

/** Empresta uma habilidade por um tempo, sem custo extra de energia. */
function grantBorrowedAbility(
  match: MatchState,
  player: PlayerMatchState,
  targetId: string,
  nowMs: number,
  durationMs: number,
): void {
  const system = player.abilitySystem;
  for (const [id, runtime] of Object.entries(system.abilities)) {
    if (runtime.borrowed) delete system.abilities[id];
  }

  // Só guarda o slot: a habilidade é disparada quando o jogador apertar a tecla.
  system.abilities[targetId] = {
    abilityId: targetId,
    cooldownRemainingMs: 0,
    armedUntilMs: null,
    activeUntilMs: null,
    borrowed: true,
    borrowedUntilMs: nowMs + durationMs,
  };
  if (player.side === "left") match.copiedAbilityId = targetId;
}

export function tryActivateAbility(
  match: MatchState,
  abilityId: string,
  nowMs: number,
  player: PlayerMatchState = match.localPlayer,
): ActivateAbilityResult {
  const ability = getAbility(abilityId);
  const system = player.abilitySystem;
  const prefix = player.side === "right" ? "IA · " : "";
  const isBorrowed = system.abilities[abilityId]?.borrowed === true;

  const result = activateAbility(system, abilityId, nowMs);
  if (result.ok) {
    // Duração das habilidade temporárias também escala com o atributo dono do efeito.
    const runtime = system.abilities[abilityId];
    const stats = player.hero.stats;
    let extraMs = 0;
    if (abilityId === "mao_grande") extraMs = (stats.goalkeeping - STAT_REFERENCE) * 12;
    if (abilityId === "zaga_magnetica") extraMs = (stats.defense - STAT_REFERENCE) * 12;
    if (abilityId === "rotacionar") extraMs = (stats.ballControl - STAT_REFERENCE) * 12;
    if (runtime && runtime.activeUntilMs !== null && extraMs !== 0) {
      runtime.activeUntilMs += clamp(Math.round(extraMs), -600, 900);
    }

    let toastTitle = ability.name;
    let toastDetail = ability.hint;
    let toastColor = ABILITY_COLORS[ability.id] ?? "#ffb347";

    // Cópia: ganha um slot extra com a habilidade emprestada por alguns segundos.
    if (abilityId === "copia") {
      const durationMs = Math.max(1000, (runtime?.activeUntilMs ?? nowMs + 9000) - nowMs);
      const targetId = pickCopyTarget(match, player);
      if (targetId) {
        const borrowedAbility = getAbility(targetId);
        grantBorrowedAbility(match, player, targetId, nowMs, durationMs);
        toastTitle = "CÓPIA";
        toastDetail = `${borrowedAbility.name} emprestada por ${(durationMs / 1000).toFixed(0)}s!`;
        toastColor = ABILITY_COLORS.copia ?? "#ffe7a3";
        addEffect(match, match.ball.pos.x, match.ball.pos.y, 0.9, toastColor, "ability", "CÓPIA");
      }
    }

    // Rebote: libera o contra-ataque enquanto a habilidade estiver ativa.
    // O estado é global e pertence ao jogador local; a IA não usa esta habilidade.
    if (abilityId === "rebote" && player.side === "left") {
      match.reboteCounterAvailable = true;
    }

    // Rotacionar: liga o estado do meio girando. O estado guarda o lado dono,
    // então funciona tanto no jogador local quanto em uma habilidade copiada.
    if (abilityId === "rotacionar" && runtime && runtime.activeUntilMs !== null) {
      const durationMs = Math.max(1000, runtime.activeUntilMs - nowMs);
      const mods = getPlayerModifiers(match, player, "meio");
      match.rotation = {
        ownerSide: player.side,
        rodId: "meio",
        remainingMs: durationMs,
        totalMs: durationMs,
        angle: 0,
        angularSpeed: mods.rotationSpeed,
        kickUsed: false,
        color: ABILITY_COLORS.rotacionar ?? "#ff9f43",
      };
      addEffect(match, match.ball.pos.x, match.ball.pos.y, 0.9, match.rotation.color, "ability", "ROTACIONAR");
    }

    // Tenta executar na hora; se não houver bola perto, mantém armada.
    const auto = tryAutoExecuteAbility(match, ability, player);
    const cost = isBorrowed ? "cópia" : `-${ability.cost} energia`;
    pushLog(match, auto
      ? `${prefix}${ability.name}${isBorrowed ? " (cópia)" : ""} pegou a bola e executou sozinha!`
      : ability.trigger === "timed"
        ? `${prefix}${ability.name} ativada (${cost}).`
        : `${prefix}${ability.name} armada (${cost}).`);
    if (isBorrowed) toastTitle = `CÓPIA · ${toastTitle}`;
    if (prefix) toastTitle = `${prefix.trim()} ${toastTitle}`;
    showToast(match, toastTitle, auto && abilityId !== "copia" ? `AUTO · ${toastDetail}` : toastDetail, toastColor);
  } else {
    pushLog(match, `${prefix}${ability.name}: ${result.reason}`);
    showToast(match, `${prefix}${ability.name}`, result.reason, "#ff7b7b");
  }
  return result;
}

export function tryConsumeArmedAbility(
  match: MatchState,
  abilityId: string,
  nowMs: number,
  player: PlayerMatchState = match.localPlayer,
): void {
  const consumed = consumeArmedAbility(player.abilitySystem, abilityId, nowMs);
  if (consumed) {
    const ability = getAbility(abilityId) as AbilityDefinition;
    const prefix = player.side === "right" ? "IA · " : "";
    pushLog(match, `${prefix}${ability.name} disparou!`);
    showToast(match, `${prefix}${ability.name} ATIVO`, ability.hint, ABILITY_COLORS[ability.id] ?? "#ffb347");
  }
}

export function performKickForPlayer(
  match: MatchState,
  player: PlayerMatchState,
  rodId: RodId,
  power01: number,
  direction: 1 | -1,
  reach?: { x: number; y: number },
): void {
  const rod = getPlayerRod(match, rodId, player);
  if (!rod || match.elastic || match.choreography) return;
  if (match.ball.explosionCompressMs > 0 || match.ball.explosionHopRemainingMs > 0) return;

  // Consome habilidades armadas ANTES de calcular o chute, para o bônus valer nele.
  for (const abilityId of getEquippedAbilityIds(match, player)) {
    const ability = getAbility(abilityId);
    if (ability.trigger === "next_kick" && ability.allowedRods.includes(rodId)) {
      tryConsumeArmedAbility(match, abilityId, match.nowMs, player);
    }
  }

  const mods = getPlayerModifiers(match, player, rodId);
  const effectivePower = Math.min(MAX_KICK_POWER, power01 * mods.kickPowerMult);
  triggerRodKick(rod, Math.min(MAX_TRIGGER_POWER, effectivePower));
  const hit = applyKickToBall(match, rod, effectivePower, direction, mods, reach?.x, reach?.y);
  if (hit) {
    // A carga ofensiva usa a força real do chute, não só o tempo de carga.
    registerAbilityCharge(match, player, { type: "attack_kick", power: effectivePower });
  }
  // Coreografia e Explosão já assumiram a bola dentro de applyKickToBall.
  const ballTaken = match.choreography !== null
    || match.ball.explosionCompressMs > 0
    || match.ball.explosionHopRemainingMs > 0;
  // Elástico e Combo usam estado global do jogador local; a IA não possui essas habilidades.
  if (ballTaken) {
    return;
  }
  if (hit && mods.elastic && player.side === "left") {
    // O Elástico assume a bola: a órbita decide quando e de onde o ataque sai.
    match.combo = null;
    startElastic(match, rod, mods);
  } else if (hit && mods.combo && player.side === "left") {
    match.combo = {
      rodId,
      remainingKicks: mods.comboKicks,
      nextAtMs: match.nowMs + mods.comboIntervalMs,
      power: Math.min(1, power01),
      direction,
      intervalMs: mods.comboIntervalMs,
    };
  } else if (!hit && player.side === "left") {
    match.combo = null;
    const rodX = rod.xRatio * match.field.width;
    addEffect(match, rodX, match.field.height / 2 + rod.yOffset, power01 * 0.6, "#7fd6ff55", "miss");
  }
}

export function performKick(
  match: MatchState,
  rodId: RodId,
  power01: number,
  direction: 1 | -1,
  reach?: { x: number; y: number },
): void {
  performKickForPlayer(match, match.localPlayer, rodId, power01, direction, reach);
}

/** Move a barra de qualquer jogador (usado pelo host para o input remoto). */
export function moveRodForPlayer(
  match: MatchState,
  player: PlayerMatchState,
  rodId: RodId,
  axis: -1 | 0 | 1,
  deltaMs: number,
): void {
  if (match.nowMs < match.lockMovementUntilMs) return; // Roletada travou o manete
  const rod = getPlayerRod(match, rodId, player);
  if (!rod) return;
  const mods = getPlayerModifiers(match, player, rodId);
  rod.yOffset += axis * 340 * mods.rodSpeedMult * (deltaMs / 1000);
  clampRodOffset(rod, match.field.height);
}

export function movePlayerRod(match: MatchState, rodId: RodId, axis: -1 | 0 | 1, deltaMs: number): void {
  if (match.nowMs < match.lockMovementUntilMs) return; // Roletada travou o manete
  moveRodForPlayer(match, match.localPlayer, rodId, axis, deltaMs);
}

export function setPlayerRodCharge(match: MatchState, rodId: RodId, charging: boolean): void {
  const rod = getPlayerRod(match, rodId);
  if (rod) rod.charge = charging ? 1 : 0;
}
