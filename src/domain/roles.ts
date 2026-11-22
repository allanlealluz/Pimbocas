import type { ChargeEvent, ChargeEventType, Role } from "./types";

/** Ganho de um ofensivo com um chute de força 1,0 (carga cheia, stat na média). */
const ATTACK_GAIN_PER_POWER = 4;
/** Ganho de um defensivo ao defender um impacto 1,0. */
const DEFENSE_GAIN_PER_IMPACT = 12;

/** Cada tipo de defesa pesa diferente dentro da categoria defensiva. */
const DEFENSE_EVENT_WEIGHT: Partial<Record<ChargeEventType, number>> = {
  defense_block: 0.7,
  defense_intercept: 0.9,
  defense_save: 1.4,
};

export interface RoleChargeProfile {
  passivePerSecond: number;
  /** Pontos por unidade de força efetiva do chute (já inclui stats e habilidades). */
  kickGainPerPower: number;
  /** Pontos por unidade de impacto da bola defendida. */
  defenseGainPerImpact: number;
  /** Eventos pontuais que não são proporcionais a força/impacto. */
  fixedGain: Partial<Record<ChargeEventType, number>>;
}

/**
 * Ofensivo: ganha chutando, proporcional à força do chute.
 * Defensivo: ganha defendendo, proporcional ao impacto da bola.
 * Coringa: 30% dos dois ganhos acima.
 */
export const ROLE_CHARGE_PROFILES: Record<Role, RoleChargeProfile> = {
  ofensivo: {
    passivePerSecond: 1.2,
    kickGainPerPower: ATTACK_GAIN_PER_POWER,
    defenseGainPerImpact: 0,
    fixedGain: { attack_goal: 16, attack_useful_pass: 4 },
  },
  defensivo: {
    passivePerSecond: 1.2,
    kickGainPerPower: 0,
    defenseGainPerImpact: DEFENSE_GAIN_PER_IMPACT,
    fixedGain: { attack_goal: 6, attack_useful_pass: 2 },
  },
  coringa: {
    passivePerSecond: 1.5,
    kickGainPerPower: ATTACK_GAIN_PER_POWER * 0.3,
    defenseGainPerImpact: DEFENSE_GAIN_PER_IMPACT * 0.3,
    fixedGain: {
      attack_goal: 16 * 0.3,
      attack_useful_pass: 4 * 0.3,
    },
  },
};

export interface ChargeGainInput {
  amountMult?: number;
  /** Força efetiva do chute, após stats e habilidades. */
  power?: number;
  /** Intensidade da bola no momento da defesa. */
  impact?: number;
}

export function getChargeGain(role: Role, eventType: ChargeEventType, input: ChargeGainInput = {}): number {
  const profile = ROLE_CHARGE_PROFILES[role];
  const mult = input.amountMult ?? 1;

  if (eventType === "passive_tick") return profile.passivePerSecond;

  if (eventType === "attack_kick") {
    return profile.kickGainPerPower * (input.power ?? mult);
  }
  if (eventType === "attack_useful_pass") {
    return profile.kickGainPerPower * 0.5 * (input.power ?? mult);
  }

  const defenseWeight = DEFENSE_EVENT_WEIGHT[eventType];
  if (defenseWeight !== undefined) {
    return profile.defenseGainPerImpact * (input.impact ?? mult) * defenseWeight;
  }

  return (profile.fixedGain[eventType] ?? 0) * mult;
}

/** Exposto para a UI explicar as regras sem duplicar números. */
export const ROLE_CHARGE_SUMMARY: Record<Role, string> = {
  ofensivo: "Enche chutando: quanto mais forte o chute, mais energia.",
  defensivo: "Enche defendendo: quanto mais forte a bola, mais energia.",
  coringa: "Recebe 30% do ganho ofensivo e 30% do defensivo.",
};

export type { ChargeEvent };
