import type { RodId } from "../domain/types";

export type TeamSide = "left" | "right";

export interface RodConfig {
  id: RodId;
  side: TeamSide;
  /** Posição X normalizada no campo (0-1) */
  xRatio: number;
  figureCount: number;
  /** Espaçamento fixo entre bonecos da mesma barra (px) */
  spacing: number;
  color: string;
}

export interface RodState extends RodConfig {
  /** Deslocamento vertical do grupo de bonecos */
  yOffset: number;
  /** Posição anterior (para calcular velocidade vertical) */
  prevYOffset: number;
  /** Velocidade vertical da barra em px/s */
  vy: number;
  /** Ângulo de chute atual (radianos) */
  kickAngle: number;
  /** Velocidade angular do chute */
  kickVel: number;
  /** 0-1 carga visual de chute */
  charge: number;
  /** Último contato com a bola (usado para evitar spam de eventos/efeitos) */
  lastContactMs: number;
}

/**
 * Formação 1-3-4-3 por lado (goleiro, defesa, meio, ataque), total 8 barras.
 * Layout intercalado como no pebolim real:
 * GOL(L) - DEF(L) - ATA(R) - MEI(L) - MEI(R) - ATA(L) - DEF(R) - GOL(R)
 *
 * Observação: formações variam por mesa (1-2-5-3 também é comum).
 */
export const PLAYER_RODS: RodConfig[] = [
  { id: "goleiro", side: "left", xRatio: 0.08, figureCount: 1, spacing: 0,   color: "#7fd6ff" },
  { id: "defesa",  side: "left", xRatio: 0.20, figureCount: 3, spacing: 120, color: "#7fd6ff" },
  { id: "meio",    side: "left", xRatio: 0.44, figureCount: 4, spacing: 105, color: "#7fd6ff" },
  { id: "ataque",  side: "left", xRatio: 0.68, figureCount: 3, spacing: 120, color: "#7fd6ff" },
];

export const AI_RODS: RodConfig[] = [
  { id: "goleiro", side: "right", xRatio: 0.92, figureCount: 1, spacing: 0,   color: "#ff9f87" },
  { id: "defesa",  side: "right", xRatio: 0.80, figureCount: 3, spacing: 120, color: "#ff9f87" },
  { id: "meio",    side: "right", xRatio: 0.56, figureCount: 4, spacing: 105, color: "#ff9f87" },
  { id: "ataque",  side: "right", xRatio: 0.32, figureCount: 3, spacing: 120, color: "#ff9f87" },
];

export function createRodState(cfg: RodConfig): RodState {
  return { ...cfg, yOffset: 0, prevYOffset: 0, vy: 0, kickAngle: 0, kickVel: 0, charge: 0, lastContactMs: -1000 };
}

export function createAllRods(): RodState[] {
  return [...PLAYER_RODS, ...AI_RODS].map(createRodState);
}

export function getRodFiguresY(rod: RodState, fieldHeight: number): number[] {
  const center = fieldHeight / 2 + rod.yOffset;
  if (rod.figureCount === 1) return [center];
  const totalSpan = rod.spacing * (rod.figureCount - 1);
  const start = center - totalSpan / 2;
  return Array.from({ length: rod.figureCount }, (_, i) => start + i * rod.spacing);
}

export interface FigureContact {
  x: number;
  y: number;
  r: number;
  isFoot: boolean;
}

/** Círculos de colisão do boneco: corpo e bota (que é a parte que chuta). */
export function getFigureContacts(rod: RodState, figureY: number, fieldWidth: number, guardBonus = 0): FigureContact[] {
  const rodX = rod.xRatio * fieldWidth;
  const dir = rod.side === "left" ? 1 : -1;
  const kickExt = Math.sin(Math.abs(rod.kickAngle)) * 10;
  return [
    { x: rodX, y: figureY - 4, r: 13 + guardBonus, isFoot: false },
    { x: rodX + dir * (8 + kickExt), y: figureY + 12, r: 8 + guardBonus, isFoot: true },
  ];
}

/** Velocidade horizontal da bota durante o giro do chute. */
export function getFootVelocityX(rod: RodState): number {
  return -rod.kickVel * 16;
}

export function clampRodOffset(rod: RodState, fieldHeight: number): void {
  const minY = 55;
  const maxY = fieldHeight - 55;
  const center = fieldHeight / 2;
  if (rod.figureCount === 1) {
    rod.yOffset = Math.max(minY - center, Math.min(maxY - center, rod.yOffset));
    return;
  }
  const totalSpan = rod.spacing * (rod.figureCount - 1);
  const halfSpan = totalSpan / 2;
  const minOffset = minY + halfSpan - center;
  const maxOffset = maxY - halfSpan - center;
  rod.yOffset = Math.max(minOffset, Math.min(maxOffset, rod.yOffset));
}

export function triggerRodKick(rod: RodState, power01: number): void {
  // Direção do giro depende do lado: esquerda chuta para a direita, direita para a esquerda.
  rod.kickVel = -(7 + power01 * 10) * (rod.side === "left" ? 1 : -1);
}

export function updateRod(rod: RodState, deltaMs: number, fieldHeight: number): void {
  const dt = Math.max(0.001, deltaMs / 1000);
  // Retorno elástico do boneco após o chute.
  rod.kickVel += -rod.kickAngle * 55 * dt;
  rod.kickVel *= Math.pow(0.86, deltaMs / 16.67);
  rod.kickAngle += rod.kickVel * dt;
  if (Math.abs(rod.kickAngle) < 0.001 && Math.abs(rod.kickVel) < 0.001) {
    rod.kickAngle = 0;
    rod.kickVel = 0;
  }
  clampRodOffset(rod, fieldHeight);
  // Velocidade vertical usada na colisão com a bola.
  rod.vy = dt > 0 ? (rod.yOffset - rod.prevYOffset) / dt : 0;
  rod.prevYOffset = rod.yOffset;
}
