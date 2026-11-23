import { getAbility } from "../domain/abilities";
import { getChargeGain } from "../domain/roles";
import type {
  AbilityDefinition,
  AbilityRuntimeState,
  ChargeEvent,
  HeroDefinition,
  RodId,
  Role,
  SpecialBarState,
} from "../domain/types";

export interface AbilitySystemState {
  role: Role;
  bar: SpecialBarState;
  abilities: Record<string, AbilityRuntimeState>;
}

export function createSpecialBar(segments: number[]): SpecialBarState {
  if (segments.length === 0) throw new Error("Special bar must have at least one segment");
  if (segments.some((s) => s <= 0)) throw new Error("Segments must be positive");
  const max = segments.reduce((sum, s) => sum + s, 0);
  return {
    current: 0,
    max,
    segments: [...segments],
  };
}

export function createAbilitySystem(hero: HeroDefinition): AbilitySystemState {
  const abilities: Record<string, AbilityRuntimeState> = {};
  for (const abilityId of hero.abilities) {
    abilities[abilityId] = {
      abilityId,
      cooldownRemainingMs: 0,
      armedUntilMs: null,
      activeUntilMs: null,
    };
  }

  return {
    role: hero.role,
    bar: createSpecialBar(hero.specialBar.segments),
    abilities,
  };
}

export function getFilledSegments(bar: SpecialBarState): number {
  let remaining = bar.current;
  let filled = 0;
  for (const segment of bar.segments) {
    if (remaining >= segment) {
      filled += 1;
      remaining -= segment;
    } else {
      break;
    }
  }
  return filled;
}

export function getSegmentProgress(bar: SpecialBarState): Array<{
  size: number;
  filled: number;
  ratio: number;
}> {
  let remaining = bar.current;
  return bar.segments.map((size) => {
    const filled = Math.max(0, Math.min(size, remaining));
    remaining -= size;
    return { size, filled, ratio: size === 0 ? 0 : filled / size };
  });
}

export function applyCharge(state: AbilitySystemState, event: ChargeEvent): number {
  const gain = getChargeGain(state.role, event.type, event);
  const before = state.bar.current;
  state.bar.current = Math.min(state.bar.max, state.bar.current + gain);
  return state.bar.current - before;
}

export function tickAbilitySystem(state: AbilitySystemState, deltaMs: number, nowMs: number): void {
  // Carga passiva baseada no tempo real decorrido.
  const passiveGain = getChargeGain(state.role, "passive_tick") * (deltaMs / 1000);
  state.bar.current = Math.min(state.bar.max, state.bar.current + passiveGain);

  for (const runtime of Object.values(state.abilities)) {
    runtime.cooldownRemainingMs = Math.max(0, runtime.cooldownRemainingMs - deltaMs);
    if (runtime.armedUntilMs !== null && nowMs >= runtime.armedUntilMs) {
      runtime.armedUntilMs = null;
    }
    if (runtime.activeUntilMs !== null && nowMs >= runtime.activeUntilMs) {
      runtime.activeUntilMs = null;
    }
    // Habilidade emprestada pela Cópia some quando o empréstimo termina,
    // mesmo que o jogador ainda não tenha apertado o slot copiado.
    if (runtime.borrowed && (runtime.borrowedUntilMs ?? runtime.activeUntilMs) !== null
      && nowMs >= (runtime.borrowedUntilMs ?? runtime.activeUntilMs ?? 0)) {
      delete state.abilities[runtime.abilityId];
    }
  }
}

export type ActivateAbilityResult =
  | { ok: true; ability: AbilityDefinition }
  | { ok: false; reason: string };

export function activateAbility(
  state: AbilitySystemState,
  abilityId: string,
  nowMs: number,
): ActivateAbilityResult {
  const ability = getAbility(abilityId);
  const runtime = state.abilities[abilityId];
  if (!runtime) return { ok: false, reason: "Habilidade não equipada neste herói." };
  if (runtime.cooldownRemainingMs > 0) return { ok: false, reason: "Habilidade em cooldown." };
  if (runtime.armedUntilMs !== null && nowMs < runtime.armedUntilMs) {
    return { ok: false, reason: "Habilidade já está armada." };
  }
  if (runtime.activeUntilMs !== null && nowMs < runtime.activeUntilMs && !runtime.borrowed) {
    return { ok: false, reason: "Habilidade já está ativa." };
  }
  // A habilidade copiada não custa energia: ela já foi paga pela Cópia.
  if (!runtime.borrowed && state.bar.current < ability.cost) {
    return { ok: false, reason: "Energia insuficiente." };
  }

  if (!runtime.borrowed) state.bar.current -= ability.cost;
  runtime.cooldownRemainingMs = ability.cooldownMs;

  if (ability.trigger === "instant" || ability.trigger === "timed") {
    runtime.activeUntilMs = nowMs + (ability.effect.durationMs ?? 0);
    runtime.armedUntilMs = null;
  } else {
    // next_kick / next_defense: arma a habilidade por uma janela.
    runtime.armedUntilMs = nowMs + (ability.activationWindowMs ?? 1500);
    runtime.activeUntilMs = null;
  }

  return { ok: true, ability };
}

export function consumeArmedAbility(
  state: AbilitySystemState,
  abilityId: string,
  nowMs: number,
): boolean {
  const runtime = state.abilities[abilityId];
  const ability = getAbility(abilityId);
  if (!runtime || runtime.armedUntilMs === null) return false;
  if (nowMs > runtime.armedUntilMs) {
    runtime.armedUntilMs = null;
    return false;
  }
  runtime.armedUntilMs = null;
  // Janela mínima para o efeito valer no próprio chute que o disparou.
  // Na cópia, respeita o tempo que ainda resta do empréstimo.
  const minimumUntilMs = Math.min(
    nowMs + Math.max(300, ability.effect.durationMs ?? 0),
    runtime.borrowedUntilMs ?? Number.POSITIVE_INFINITY,
  );
  runtime.activeUntilMs = Math.max(runtime.activeUntilMs ?? 0, minimumUntilMs);
  return true;
}

export function isAbilityActiveAt(state: AbilitySystemState, abilityId: string, nowMs: number): boolean {
  const until = state.abilities[abilityId]?.activeUntilMs;
  return until !== null && until !== undefined && nowMs < until;
}

export function isAbilityArmedAt(state: AbilitySystemState, abilityId: string, nowMs: number): boolean {
  const until = state.abilities[abilityId]?.armedUntilMs;
  return until !== null && until !== undefined && nowMs < until;
}

export interface AbilityModifiers {
  ballSpeedMult: number;
  kickPowerMult: number;
  reboundMult: number;
  rodSpeedMult: number;
  /** Multiplicador aplicado à velocidade da bola depois do contato (1 = neutro). */
  ballDrain: number;
  reachBonus: number;
  guardBonus: number;
  diagonal: boolean;
  /** Cruzador Estelar */
  stellar: boolean;
  trajectoryKeep: number;
  spinRetention: number;
  /** Chute Fantasma */
  phantom: boolean;
  ghostDelayMs: number;
  ghostStrength: number;
  /** Combo Breaker */
  combo: boolean;
  comboKicks: number;
  comboIntervalMs: number;
  /** Mão Grande */
  bigHand: boolean;
  bigHandRadius: number;
  /** Chute de Goleiro */
  goalkeeperKick: boolean;
  goalkeeperKickSpeedMult: number;
  /** Zaga Magnética */
  magnetic: boolean;
  magnetRadius: number;
  magnetStrength: number;
  /** Chute Relâmpago */
  lightning: boolean;
  lightningSpeedMult: number;
  /** Elástico */
  elastic: boolean;
  elasticMinMs: number;
  elasticMaxMs: number;
  /** Força Bruta */
  brute: boolean;
  bruteSpeedMult: number;
  bruteBounce: number;
  /** Roletada */
  roletada: boolean;
  roletadaSpeedMult: number;
  lockMovementMs: number;
  /** Rebote */
  rebote: boolean;
  rebotePower: number;
  /** Os Gêmeos: passe coreografado entre barras */
  choreography: boolean;
  choreographyTarget: RodId | null;
  choreographySpeed: number;
  choreographyPower: number;
  /** Churrasqueiro: meio girando */
  rotation: boolean;
  rotationSpeed: number;
  /** Churrasqueiro: compressão + pulo + saída rodando */
  explosion: boolean;
  explosionSpeedMult: number;
  explosionCompressMs: number;
  explosionHopMs: number;
  explosionHopDistance: number;
  explosionHopHeight: number;
  explosionSpin: number;
  explosionRollingMs: number;
  activeIds: string[];
}

export const NEUTRAL_MODIFIERS: AbilityModifiers = {
  ballSpeedMult: 1,
  kickPowerMult: 1,
  reboundMult: 1,
  rodSpeedMult: 1,
  ballDrain: 1,
  reachBonus: 0,
  guardBonus: 0,
  diagonal: false,
  stellar: false,
  trajectoryKeep: 0,
  spinRetention: 1,
  phantom: false,
  ghostDelayMs: 0,
  ghostStrength: 0,
  combo: false,
  comboKicks: 0,
  comboIntervalMs: 0,
  bigHand: false,
  bigHandRadius: 0,
  goalkeeperKick: false,
  goalkeeperKickSpeedMult: 1,
  magnetic: false,
  magnetRadius: 0,
  magnetStrength: 0,
  lightning: false,
  lightningSpeedMult: 1,
  elastic: false,
  elasticMinMs: 0,
  elasticMaxMs: 0,
  brute: false,
  bruteSpeedMult: 1,
  bruteBounce: 0.82,
  roletada: false,
  roletadaSpeedMult: 1,
  lockMovementMs: 0,
  rebote: false,
  rebotePower: 1,
  choreography: false,
  choreographyTarget: null,
  choreographySpeed: 0,
  choreographyPower: 1,
  rotation: false,
  rotationSpeed: 0,
  explosion: false,
  explosionSpeedMult: 1,
  explosionCompressMs: 0,
  explosionHopMs: 0,
  explosionHopDistance: 0,
  explosionHopHeight: 0,
  explosionSpin: 0,
  explosionRollingMs: 0,
  activeIds: [],
};

/** Modificadores de todas as habilidades ativas que valem para esta barra. */
export function getAbilityModifiers(
  state: AbilitySystemState,
  rodId: RodId,
  nowMs: number,
): AbilityModifiers {
  const mods: AbilityModifiers = { ...NEUTRAL_MODIFIERS, activeIds: [] };
  for (const runtime of Object.values(state.abilities)) {
    if (!isAbilityActiveAt(state, runtime.abilityId, nowMs)) continue;
    const ability = getAbility(runtime.abilityId);
    if (!ability.allowedRods.includes(rodId)) continue;

    mods.ballSpeedMult *= ability.effect.ballSpeedMult ?? 1;
    mods.kickPowerMult *= ability.effect.kickPowerMult ?? 1;
    if (ability.effect.reboundMult !== undefined) {
      mods.reboundMult = Math.min(mods.reboundMult, ability.effect.reboundMult);
    }
    switch (ability.effect.tag) {
      case "read_play":
        mods.rodSpeedMult *= 1.25;
        break;
      case "diagonal_shot":
        mods.diagonal = true;
        mods.reachBonus += 6;
        break;
      case "heavy_block":
        mods.guardBonus += 4;
        break;
      case "stellar_cross":
        mods.stellar = true;
        mods.trajectoryKeep = Math.max(mods.trajectoryKeep, ability.effect.trajectoryKeep ?? 0.75);
        mods.spinRetention = Math.min(mods.spinRetention, ability.effect.spinRetention ?? 0.2);
        break;
      case "phantom_shot":
        mods.phantom = true;
        mods.ghostDelayMs = Math.max(mods.ghostDelayMs, ability.effect.ghostDelayMs ?? 260);
        mods.ghostStrength = Math.max(mods.ghostStrength, ability.effect.ghostStrength ?? 1);
        break;
      case "combo_breaker":
        mods.combo = true;
        mods.comboKicks = Math.max(mods.comboKicks, ability.effect.comboKicks ?? 3);
        mods.comboIntervalMs = Math.max(mods.comboIntervalMs, ability.effect.comboIntervalMs ?? 150);
        break;
      case "big_hand":
        mods.bigHand = true;
        mods.bigHandRadius = Math.max(mods.bigHandRadius, ability.effect.goalieAuraRadius ?? 12);
        break;
      case "goalkeeper_kick":
        mods.goalkeeperKick = true;
        mods.goalkeeperKickSpeedMult = Math.max(
          mods.goalkeeperKickSpeedMult,
          ability.effect.goalieKickSpeedMult ?? 1.35,
        );
        break;
      case "magnetic_defense":
        mods.magnetic = true;
        mods.magnetRadius = Math.max(mods.magnetRadius, ability.effect.magnetRadius ?? 140);
        mods.magnetStrength = Math.max(mods.magnetStrength, ability.effect.magnetStrength ?? 520);
        break;
      case "lightning_shot":
        mods.lightning = true;
        mods.lightningSpeedMult = Math.max(mods.lightningSpeedMult, ability.effect.lightningSpeedMult ?? 1.2);
        break;
      case "elastico":
        mods.elastic = true;
        mods.elasticMinMs = Math.max(mods.elasticMinMs, ability.effect.elasticMinMs ?? 1000);
        mods.elasticMaxMs = Math.max(mods.elasticMaxMs, ability.effect.elasticMaxMs ?? 5000);
        break;
      case "brute_force":
        mods.brute = true;
        mods.bruteSpeedMult = Math.max(mods.bruteSpeedMult, ability.effect.bruteSpeedMult ?? 1.5);
        mods.bruteBounce = Math.max(mods.bruteBounce, ability.effect.bruteBounce ?? 0.95);
        break;
      case "roletada":
        mods.roletada = true;
        mods.roletadaSpeedMult = Math.max(mods.roletadaSpeedMult, ability.effect.roletadaSpeedMult ?? 1.35);
        mods.lockMovementMs = Math.max(mods.lockMovementMs, ability.effect.lockMovementMs ?? 1400);
        break;
      case "rebote":
        mods.rebote = true;
        mods.rebotePower = Math.max(mods.rebotePower, ability.effect.rebotePower ?? 1.25);
        break;
      case "chute_duplo":
      case "sequencia_toques":
        mods.choreography = true;
        mods.choreographyTarget = ability.effect.choreographyTarget ?? (ability.id === "chute_duplo" ? "ataque" : "meio");
        mods.choreographySpeed = Math.max(mods.choreographySpeed, ability.effect.choreographySpeed ?? 400);
        mods.choreographyPower = Math.max(mods.choreographyPower, ability.effect.choreographyPower ?? 1.2);
        break;
      case "rotacionar":
        mods.rotation = true;
        mods.rotationSpeed = Math.max(mods.rotationSpeed, ability.effect.rotationSpeed ?? 7);
        break;
      case "explosao":
        mods.explosion = true;
        mods.explosionSpeedMult = Math.max(mods.explosionSpeedMult, ability.effect.explosionSpeedMult ?? 1.25);
        mods.explosionCompressMs = Math.max(mods.explosionCompressMs, ability.effect.explosionCompressMs ?? 260);
        mods.explosionHopMs = Math.max(mods.explosionHopMs, ability.effect.explosionHopMs ?? 220);
        mods.explosionHopDistance = Math.max(mods.explosionHopDistance, ability.effect.explosionHopDistance ?? 78);
        mods.explosionHopHeight = Math.max(mods.explosionHopHeight, ability.effect.explosionHopHeight ?? 26);
        mods.explosionSpin = Math.max(mods.explosionSpin, ability.effect.explosionSpin ?? 22);
        mods.explosionRollingMs = Math.max(mods.explosionRollingMs, ability.effect.explosionRollingMs ?? 1600);
        break;
    }
    mods.activeIds.push(ability.id);
  }
  return mods;
}

export interface ActiveAbilityView {
  ability: AbilityDefinition;
  armed: boolean;
  active: boolean;
  remainingMs: number;
}

/** Lista para a interface: o que está armado/ativo e por quanto tempo. */
export function getAbilityViews(state: AbilitySystemState, nowMs: number): ActiveAbilityView[] {
  return Object.values(state.abilities).map((runtime) => {
    const ability = getAbility(runtime.abilityId);
    const armed = runtime.armedUntilMs !== null && nowMs < runtime.armedUntilMs;
    const active = runtime.activeUntilMs !== null && nowMs < runtime.activeUntilMs;
    const until = armed ? runtime.armedUntilMs! : active ? runtime.activeUntilMs! : nowMs;
    return { ability, armed, active, remainingMs: Math.max(0, until - nowMs) };
  });
}
