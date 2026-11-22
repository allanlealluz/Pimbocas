export interface Vector2 {
  x: number;
  y: number;
}

export interface BallState {
  pos: Vector2;
  vel: Vector2;
  radius: number;
  /** Tempo acumulado com velocidade muito baixa (anti-ficada presa) */
  stuckMs: number;
  /** Giro da bola (rad/s) — curva o trajetório e gira o desenho */
  spin: number;
  /** Rotação acumulada para o desenho da bola */
  roll: number;
  /** Trajetória travada pelo Cruzador Estelar (sobrevive à defesa) */
  guideVx: number;
  guideVy: number;
  guideRemainingMs: number;
  guideKeep: number;
  guideSpin: number;
  /** Velocidade original do Cruzador, usada para furar a defesa. */
  guideSpeed: number;
  /** Fator de retenção do giro: 1 = normal, menor = giro dura mais */
  spinRetention: number;
  /** Chute Fantasma: tempo restante da finta e giro depois dela */
  phantomRemainingMs: number;
  phantomSpin: number;
  /** Chute de Goleiro: gol vale 2 enquanto a bola não tocou em nada. */
  untouchedGoalKick: boolean;
  /** Chute Relâmpago: ao bater na parede, redireciona para a área do gol. */
  lightningBounce: boolean;
  /** Chute Relâmpago: reforço de velocidade aplicado na quicada. */
  lightningSpeedMult: number;
  /** Força Bruta: tempo restante de quicada elástica. */
  bruteMs: number;
  bruteBounce: number;
  /** Calor da arena (0-1): deixa a bola mais rápida e mais quicante. */
  heat: number;
}

export interface FieldConfig {
  width: number;
  height: number;
  goalMouth: number; // abertura do gol em px
  goalDepth: number;
}

export const DEFAULT_FIELD: FieldConfig = {
  width: 960,
  height: 540,
  goalMouth: 140,
  goalDepth: 18,
};

/** Limpa estados especiais deixados por habilidades na bola. */
export function clearBallEffects(ball: BallState): void {
  ball.guideVx = 0;
  ball.guideVy = 0;
  ball.guideRemainingMs = 0;
  ball.guideKeep = 0;
  ball.guideSpin = 0;
  ball.guideSpeed = 0;
  ball.spinRetention = 1;
  ball.phantomRemainingMs = 0;
  ball.phantomSpin = 0;
  ball.untouchedGoalKick = false;
  ball.lightningBounce = false;
  ball.lightningSpeedMult = 1;
  ball.bruteMs = 0;
  ball.bruteBounce = 0.82;
}

export function createBall(field: FieldConfig = DEFAULT_FIELD): BallState {
  const ball: BallState = {
    pos: { x: field.width / 2, y: field.height / 2 },
    vel: { x: 0, y: 0 },
    radius: 10,
    stuckMs: 0,
    spin: 0,
    roll: 0,
    guideVx: 0,
    guideVy: 0,
    guideRemainingMs: 0,
    guideKeep: 0,
    guideSpin: 0,
    guideSpeed: 0,
    spinRetention: 1,
    phantomRemainingMs: 0,
    phantomSpin: 0,
    untouchedGoalKick: false,
    lightningBounce: false,
    lightningSpeedMult: 1,
    bruteMs: 0,
    bruteBounce: 0.82,
    heat: 0,
  };
  return ball;
}

export function resetBall(ball: BallState, field: FieldConfig = DEFAULT_FIELD, direction: -1 | 1 = 1): void {
  ball.pos.x = field.width / 2;
  ball.pos.y = field.height / 2;
  ball.vel.x = 180 * direction;
  ball.vel.y = (Math.random() - 0.5) * 120;
  ball.spin = (Math.random() - 0.5) * 4;
  ball.stuckMs = 0;
  ball.heat = 0;
  clearBallEffects(ball);
}

/** Empurrão de emergência quando a bola fica imóvel entre bonecos/barras. */
export function nudgeBall(ball: BallState, field: FieldConfig): void {
  const towardCenter = ball.pos.x < field.width / 2 ? 1 : -1;
  ball.vel.x = 150 * towardCenter + (Math.random() - 0.5) * 60;
  ball.vel.y = (Math.random() - 0.5) * 260;
  ball.spin = (Math.random() - 0.5) * 10;
  ball.stuckMs = 0;
  clearBallEffects(ball);
}

export interface BallUpdateResult {
  goal: "left" | "right" | null;
  /** Chute Fantasma terminou a finta neste passo. */
  phantomEnded: boolean;
  /** Chute Relâmpago encontrou a parede e virou para o gol neste passo. */
  lightningBounced: boolean;
}

/**
 * Um passo curto da física da bola. O chamador divide o frame em subpassos
 * (via updateMatch) para evitar que a bola atravesse os bonecos em alta velocidade.
 */
export function updateBall(ball: BallState, deltaMs: number, field: FieldConfig = DEFAULT_FIELD): BallUpdateResult {
  const dt = deltaMs / 1000;
  const result: BallUpdateResult = { goal: null, phantomEnded: false, lightningBounced: false };

  // Anti-ficada: se quase parada por muito tempo, empurra de volta ao centro.
  const speed = Math.hypot(ball.vel.x, ball.vel.y);
  ball.stuckMs = speed < 45 ? ball.stuckMs + deltaMs : 0;
  if (ball.stuckMs > 700) nudgeBall(ball, field);

  if (ball.guideRemainingMs > 0) {
    ball.guideRemainingMs = Math.max(0, ball.guideRemainingMs - deltaMs);
  }
  if (ball.bruteMs > 0) {
    ball.bruteMs = Math.max(0, ball.bruteMs - deltaMs);
    if (ball.bruteMs === 0) ball.bruteBounce = 0.82;
  }

  // O Fantasma começa indo para o lado oposto da diagonal e depois retorna.
  if (ball.phantomRemainingMs > 0) {
    ball.phantomRemainingMs = Math.max(0, ball.phantomRemainingMs - deltaMs);
    if (ball.phantomRemainingMs === 0 && ball.phantomSpin !== 0) {
      ball.spin = ball.phantomSpin;
      ball.vel.y += Math.sign(ball.phantomSpin) * 90;
      ball.phantomSpin = 0;
      result.phantomEnded = true;
    }
  }

  // Efeito de giro (curva suave, como uma bola com rotação na mesa).
  // spinRetention < 1 faz o giro do Cruzador demorar muito mais para sumir.
  const retention = Math.max(0.1, Math.min(1, ball.spinRetention));
  ball.vel.y += ball.spin * 55 * dt;
  ball.spin *= Math.pow(1 - 0.014 * retention, deltaMs / 16.67);

  ball.pos.x += ball.vel.x * dt;
  ball.pos.y += ball.vel.y * dt;
  ball.roll += (Math.hypot(ball.vel.x, ball.vel.y) / ball.radius) * dt;

  // Atrito do feltro: perda suave de energia, sem parada abrupta.
  // Com a mesa em chamas o feltro "escorrega" e a bola ganha velocidade extra.
  const damping = Math.pow(0.988 + ball.heat * 0.008, deltaMs / 16.67);
  const heatBoost = 1 + ball.heat * 0.0012;
  ball.vel.x *= damping * heatBoost;
  ball.vel.y *= damping * heatBoost;
  if (Math.hypot(ball.vel.x, ball.vel.y) < 12) {
    ball.vel.x *= 0.9;
    ball.vel.y *= 0.9;
  }

  // Paredes laterais (topo/base): restituição e giro induzido.
  const top = ball.radius;
  const bottom = field.height - ball.radius;
  const wallRest = Math.min(0.99, (ball.bruteMs > 0 ? ball.bruteBounce : 0.82) + ball.heat * 0.14);
  let wallHit = false;
  if (ball.pos.y < top) {
    ball.pos.y = top;
    ball.vel.y = Math.abs(ball.vel.y) * wallRest;
    ball.spin += ball.vel.x * 0.004;
    wallHit = true;
  } else if (ball.pos.y > bottom) {
    ball.pos.y = bottom;
    ball.vel.y = -Math.abs(ball.vel.y) * wallRest;
    ball.spin -= ball.vel.x * 0.004;
    wallHit = true;
  }

  if (wallHit) {
    // Tocar na parede quebra a condição de gol "limpo" do goleiro.
    ball.untouchedGoalKick = false;
    // Chute Relâmpago: a quina devolve a bola já mirando a área do gol.
    if (ball.lightningBounce) {
      const boost = Math.max(1, ball.lightningSpeedMult);
      const speed = Math.hypot(ball.vel.x, ball.vel.y) * boost;
      const dx = field.width - ball.radius - 2 - ball.pos.x;
      const dy = field.height / 2 - ball.pos.y;
      const len = Math.hypot(dx, dy) || 1;
      ball.vel.x = (dx / len) * speed * 0.94;
      ball.vel.y = (dy / len) * speed * 0.94;
      ball.lightningBounce = false;
      ball.lightningSpeedMult = 1;
      result.lightningBounced = true;
    } else {
      ball.lightningSpeedMult = 1;
    }
  }

  const goalTop = (field.height - field.goalMouth) / 2;
  const goalBottom = (field.height + field.goalMouth) / 2;
  const inGoalMouth = ball.pos.y > goalTop && ball.pos.y < goalBottom;

  if (ball.pos.x - ball.radius < 0) {
    if (inGoalMouth) return { ...result, goal: "left" };
    ball.pos.x = ball.radius;
    ball.vel.x = Math.abs(ball.vel.x) * Math.min(0.98, 0.86 + ball.heat * 0.1);
    ball.spin *= -0.6;
    ball.untouchedGoalKick = false;
  }
  if (ball.pos.x + ball.radius > field.width) {
    if (inGoalMouth) return { ...result, goal: "right" };
    ball.pos.x = field.width - ball.radius;
    ball.vel.x = -Math.abs(ball.vel.x) * Math.min(0.98, 0.86 + ball.heat * 0.1);
    ball.spin *= -0.6;
    ball.untouchedGoalKick = false;
  }

  return result;
}

export function kickBall(ball: BallState, power01: number, directionX: -1 | 1, verticalBias = 0): void {
  const speed = 220 + power01 * 700;
  clearBallEffects(ball);
  ball.vel.x = speed * directionX;
  ball.vel.y = verticalBias * 260 + (Math.random() - 0.5) * 80;
  ball.spin = verticalBias * 8;
}
