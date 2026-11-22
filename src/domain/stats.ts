import type { HeroStats } from "./types";

/** Orçamento máximo de atributos por personagem (base ou criado). */
export const STAT_BUDGET = 200;
export const STAT_MIN = 10;
export const STAT_MAX = 100;
export const STAT_STEP = 5;

/**
 * Valor médio de um atributo dentro do orçamento de 200 (5 atributos).
 * É a referência usada pelo gameplay: acima dela há bônus, abaixo há perda.
 */
export const STAT_REFERENCE = 40;

export const STAT_KEYS = [
  "kickPower",
  "ballControl",
  "rodSpeed",
  "defense",
  "goalkeeping",
] as const satisfies ReadonlyArray<keyof HeroStats>;

export function sumStats(stats: HeroStats): number {
  return STAT_KEYS.reduce((sum, key) => sum + stats[key], 0);
}

function roundToStep(value: number): number {
  return Math.round(value / STAT_STEP) * STAT_STEP;
}

/**
 * Ajusta stats vindos de perfil salvo (que pode ter sido criado com o orçamento
 * antigo de 360) para caber no limite atual, sem quebrar os mínimos.
 */
export function normalizeHeroStats(stats: HeroStats): HeroStats {
  const result = { ...stats };
  for (const key of STAT_KEYS) {
    result[key] = Math.max(STAT_MIN, Math.min(STAT_MAX, roundToStep(result[key])));
  }

  while (sumStats(result) > STAT_BUDGET) {
    const highest = STAT_KEYS.reduce((best, key) => result[key] > result[best] ? key : best, STAT_KEYS[0]);
    result[highest] = Math.max(STAT_MIN, result[highest] - STAT_STEP);
  }

  return result;
}
