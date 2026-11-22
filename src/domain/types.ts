export type Role = "ofensivo" | "defensivo" | "coringa";

export type RodId = "goleiro" | "defesa" | "meio" | "ataque";

export type AbilityTrigger = "instant" | "next_kick" | "next_defense" | "timed";

export interface AbilityEffect {
  /** Multiplicador de velocidade da bola, ex.: 1.35 = +35% */
  ballSpeedMult?: number;
  /** Multiplicador de força do chute */
  kickPowerMult?: number;
  /** Multiplicador de controle/rebote na defesa; menor pode significar bola mais "presa" */
  reboundMult?: number;
  /** Duração em ms para efeitos temporários */
  durationMs?: number;
  /** Cruzador Estelar: quanto da trajetória sobrevive a uma defesa (0-1). */
  trajectoryKeep?: number;
  /** Cruzador Estelar: fator do decay do giro (menor = giro dura mais). */
  spinRetention?: number;
  /** Chute Fantasma: duração da finta em ms. */
  ghostDelayMs?: number;
  /** Chute Fantasma: intensidade da curva invertida. */
  ghostStrength?: number;
  /** Combo Breaker: quantidade de rechutes extras. */
  comboKicks?: number;
  /** Combo Breaker: intervalo entre os rechutes em ms. */
  comboIntervalMs?: number;
  /** Mão Grande: raio extra de pegada do goleiro em px. */
  goalieAuraRadius?: number;
  /** Chute de Goleiro: multiplicador extra de velocidade. */
  goalieKickSpeedMult?: number;
  /** Zaga Magnética: raio e força da atração sobre a bola. */
  magnetRadius?: number;
  magnetStrength?: number;
  /** Chute Relâmpago: velocidade extra depois da quicada na parede. */
  lightningSpeedMult?: number;
  /** Elástico: intervalo base (ms) em que o ataque acontece. */
  elasticMinMs?: number;
  elasticMaxMs?: number;
  /** Força Bruta: multiplicador de velocidade e restituição na quicada. */
  bruteSpeedMult?: number;
  bruteBounce?: number;
  /** Rótulo livre para prototipagem */
  tag?: string;
}

export interface AbilityDefinition {
  id: string;
  name: string;
  description: string;
  /** Frase curta mostrada na tela ao ativar, explicando o efeito. */
  hint: string;
  role: Role;
  /** Custo em pontos da barra de especial */
  cost: number;
  cooldownMs: number;
  allowedRods: RodId[];
  trigger: AbilityTrigger;
  /** Janela para executar após ativar (usado em next_kick/next_defense) */
  activationWindowMs?: number;
  effect: AbilityEffect;
}

export interface HeroStats {
  kickPower: number;   // 0-100
  ballControl: number; // 0-100
  rodSpeed: number;    // 0-100
  defense: number;     // 0-100
  goalkeeping: number; // 0-100
}

export interface SpecialBarConfig {
  /**
   * Segmentos variáveis da barra. Cada item é o tamanho do segmento.
   * Ex.: [25, 25, 25, 25], [20, 30, 50], [40, 60]
   * A soma define o máximo da barra.
   */
  segments: number[];
}

export interface HeroDefinition {
  id: string;
  name: string;
  role: Role;
  description: string;
  stats: HeroStats;
  specialBar: SpecialBarConfig;
  abilities: string[]; // AbilityDefinition ids
  /** Cor do avatar, usada pelo criador de personagens. */
  color?: string;
  /** Imagem do rosto (data URL redimensionada); aparece na borda da mesa. */
  faceImage?: string;
  /** Imagem de corpo inteiro (data URL redimensionada); aparece nos cartões. */
  bodyImage?: string;
  /** Marca heróis criados pelo jogador (editáveis/excluíveis). */
  custom?: boolean;
}

export interface SpecialBarState {
  current: number;
  max: number;
  /** Cópia da configuração de segmentos; permite layouts variáveis por herói */
  segments: number[];
}

export interface AbilityRuntimeState {
  abilityId: string;
  cooldownRemainingMs: number;
  /** Quando ativada, aguarda gatilho dentro da janela */
  armedUntilMs: number | null;
  /** Efeito temporário ativo até este timestamp */
  activeUntilMs: number | null;
}

export type ChargeEventType =
  | "passive_tick"
  | "attack_kick"
  | "attack_goal"
  | "attack_useful_pass"
  | "defense_block"
  | "defense_intercept"
  | "defense_save";

export interface ChargeEvent {
  type: ChargeEventType;
  /** Multiplicador genérico para eventos fixos. */
  amountMult?: number;
  /** Força efetiva do chute (já com stats e habilidades). */
  power?: number;
  /** Intensidade da bola no momento da defesa. */
  impact?: number;
}
