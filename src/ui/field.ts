import { ABILITY_COLORS, getAbility } from "../domain/abilities";
import { getAbilityViews } from "../game/ability-system";
import { getRodFiguresY, type RodState } from "../game/rods";
import { getHeroModifiers, type ElasticState, type KickEffect, type MatchState, type MatchToast } from "../game/match";

const RAIL = 46;

interface RodFx { color: string; armed: boolean }

export function renderField(
  canvas: HTMLCanvasElement,
  match: MatchState,
  selectedRodId?: string,
  previewAbilityId?: string | null,
  kickDirection?: 1 | -1 | null,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const w = match.field.width;
  const h = match.field.height;
  const cw = w + RAIL * 2;
  const ch = h + RAIL * 2;
  if (canvas.width !== cw || canvas.height !== ch) {
    canvas.width = cw;
    canvas.height = ch;
    canvas.style.setProperty("--canvas-ratio", String(cw / ch));
  }

  const views = getAbilityViews(match.localPlayer.abilitySystem, match.nowMs);
  const rodFx = new Map<string, RodFx>();
  for (const view of views) {
    if (!view.active && !view.armed) continue;
    const color = ABILITY_COLORS[view.ability.id] ?? "#ffb347";
    for (const rodId of view.ability.allowedRods) {
      const prev = rodFx.get(rodId);
      if (!prev || view.active) rodFx.set(rodId, { color, armed: !view.active });
    }
  }
  const ballGlow = views.find((v) => v.active)?.ability.id;

  ctx.clearRect(0, 0, cw, ch);
  drawWoodRails(ctx, cw, ch, RAIL);
  drawCrowd(ctx, cw, ch, RAIL);

  // Retratos nas bordas: adversário em cima, jogador local embaixo.
  drawPlayerFace(ctx, cw / 2, RAIL / 2, "#ff9a6b", false, null);
  drawPlayerFace(ctx, cw / 2, ch - RAIL / 2, "#6fd7ff", true, kickDirection, match.localPlayer.hero.faceImage);

  ctx.save();
  ctx.translate(RAIL, RAIL);

  drawPitch(ctx, w, h, match.field.goalMouth);
  if (match.heat > 0) drawArenaFire(ctx, w, h, match.heat);
  drawAbilityFields(ctx, match);
  if (match.elastic) drawElasticOrbit(ctx, match.elastic, match.nowMs);
  drawEffects(ctx, match.effects);
  drawRods(ctx, match.rods, w, h, selectedRodId, previewAbilityId, rodFx);
  if (match.nowMs < match.lockMovementUntilMs) drawMovementLock(ctx, match);
  drawBall(ctx, match.ball, ballGlow ? ABILITY_COLORS[ballGlow] : undefined);
  drawScore(ctx, match.score.left, match.score.right, w, match.stage);
  if (match.toast) drawToast(ctx, match.toast);
  if (kickDirection) drawKickArrow(ctx, w / 2, h - 30, kickDirection);

  ctx.restore();
}

/** Moldura de madeira da mesa de pebolim. */
function drawWoodRails(ctx: CanvasRenderingContext2D, cw: number, ch: number, rail: number): void {
  const wood = ctx.createLinearGradient(0, 0, cw, ch);
  wood.addColorStop(0, "#c28345");
  wood.addColorStop(0.45, "#8b5028");
  wood.addColorStop(1, "#c98c4c");
  ctx.fillStyle = wood;
  roundRect(ctx, 0, 0, cw, ch, 18);
  ctx.fill();

  ctx.save();
  roundRect(ctx, 0, 0, cw, ch, 18);
  ctx.clip();
  ctx.strokeStyle = "rgba(52,24,8,0.16)";
  ctx.lineWidth = 2;
  const t = performance.now() / 9000;
  for (let i = 0; i < 16; i++) {
    const y = ((i + 0.5) / 16) * ch;
    ctx.beginPath();
    for (let x = 0; x <= cw; x += 24) {
      const yy = y + Math.sin(x / 90 + i * 1.7 + t) * 4;
      if (x === 0) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }
  ctx.restore();

  ctx.strokeStyle = "rgba(255,228,178,0.4)";
  ctx.lineWidth = 2;
  roundRect(ctx, 2, 2, cw - 4, ch - 4, 16);
  ctx.stroke();

  ctx.strokeStyle = "rgba(32,12,4,0.7)";
  ctx.lineWidth = 4;
  roundRect(ctx, rail - 3, rail - 3, cw - rail * 2 + 6, ch - rail * 2 + 6, 8);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,215,160,0.28)";
  ctx.lineWidth = 1;
  roundRect(ctx, rail + 2, rail + 2, cw - rail * 2 - 4, ch - rail * 2 - 4, 6);
  ctx.stroke();
}

/** Plateia colorida nas bordas superior e inferior da mesa. */
function drawCrowd(ctx: CanvasRenderingContext2D, cw: number, ch: number, rail: number): void {
  const t = performance.now() / 300;
  const colors = ["#ff5d8f", "#ffd166", "#4dd2ff", "#8affc1", "#c792ff", "#ff9f43"];
  const row = (y: number, phase: number): void => {
    for (let x = 16; x < cw - 12; x += 19) {
      if (Math.abs(x - cw / 2) < 52) continue;
      const wave = Math.sin(t + x / 38 + phase) * 2.6;
      ctx.globalAlpha = 0.5 + 0.4 * Math.sin(t * 1.2 + x / 22 + phase);
      ctx.fillStyle = colors[Math.abs(Math.floor(x / 19) + phase) % colors.length]!;
      ctx.beginPath();
      ctx.arc(x, y + wave, 3.1, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  row(rail / 2 + 9, 0);
  row(ch - rail / 2 - 9, 2);
  ctx.globalAlpha = 1;
}

/** Ícone de rosto na borda da mesa (placeholder para a imagem do jogador). */
const imageCache = new Map<string, HTMLImageElement>();

function getCachedImage(src: string): HTMLImageElement {
  let img = imageCache.get(src);
  if (!img) {
    img = new Image();
    img.src = src;
    imageCache.set(src, img);
  }
  return img;
}

function drawPlayerFace(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  isLocal: boolean,
  kickDirection?: 1 | -1 | null,
  faceImage?: string,
): void {
  const t = performance.now();
  const pulse = Math.sin(t / 260) * 1.6;
  ctx.save();
  ctx.translate(x, y);

  const glow = ctx.createRadialGradient(0, 0, 5, 0, 0, 30);
  glow.addColorStop(0, `${color}aa`);
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.beginPath(); ctx.arc(0, 0, 30 + pulse, 0, Math.PI * 2); ctx.fill();

  ctx.fillStyle = "#141826";
  ctx.beginPath(); ctx.arc(0, 0, 19, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = isLocal ? 3.5 : 2.5;
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(0, -5, 6.5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(0, 10, 11, 7.5, 0, Math.PI, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.beginPath(); ctx.arc(-2.4, -6, 1, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(2.4, -6, 1, 0, Math.PI * 2); ctx.fill();

  // Rosto enviado pelo jogador (placeholder continua visível se a imagem falhar).
  if (faceImage) {
    const img = getCachedImage(faceImage);
    if (img.complete && img.naturalWidth > 0 && img.naturalHeight > 0) {
      ctx.save();
      ctx.beginPath(); ctx.arc(0, 0, 17, 0, Math.PI * 2); ctx.clip();
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const sx = (img.naturalWidth - side) / 2;
      const sy = (img.naturalHeight - side) / 2;
      ctx.drawImage(img, sx, sy, side, side, -17, -17, 34, 34);
      ctx.restore();
    }
  }

  if (isLocal && kickDirection) {
    const phase = (t / 6) % 10;
    ctx.strokeStyle = "rgba(255,240,170,0.9)";
    ctx.lineWidth = 2;
    ctx.globalAlpha = 1 - phase / 10;
    ctx.beginPath(); ctx.arc(0, 0, 23 + phase, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

function drawKickArrow(ctx: CanvasRenderingContext2D, x: number, y: number, direction: 1 | -1): void {
  ctx.save();
  ctx.strokeStyle = "rgba(255,220,140,0.85)";
  ctx.fillStyle = "rgba(255,220,140,0.85)";
  ctx.lineWidth = 4;
  const len = 34 * direction;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + len, y); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + len, y);
  ctx.lineTo(x + len - 10 * direction, y - 7);
  ctx.lineTo(x + len - 10 * direction, y + 7);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

function drawPitch(ctx: CanvasRenderingContext2D, w: number, h: number, goalMouth: number): void {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "#48ae6c");
  g.addColorStop(0.5, "#359b5c");
  g.addColorStop(1, "#277a48");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = "rgba(255,255,255,0.05)";
  for (let i = 0; i < 10; i++) if (i % 2 === 0) ctx.fillRect((w / 10) * i, 0, w / 10, h);

  const spot = ctx.createRadialGradient(w / 2, h * 0.35, 20, w / 2, h * 0.35, w * 0.62);
  spot.addColorStop(0, "rgba(255,255,255,0.12)");
  spot.addColorStop(1, "rgba(0,0,0,0.16)");
  ctx.fillStyle = spot;
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = "rgba(255,255,255,0.82)";
  ctx.lineWidth = 3;
  ctx.strokeRect(18, 18, w - 36, h - 36);
  ctx.beginPath(); ctx.moveTo(w / 2, 18); ctx.lineTo(w / 2, h - 18); ctx.stroke();
  ctx.beginPath(); ctx.arc(w / 2, h / 2, 58, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(w / 2, h / 2, 3, 0, Math.PI * 2); ctx.fillStyle = "rgba(255,255,255,0.85)"; ctx.fill();

  const goalTop = (h - goalMouth) / 2;
  ctx.fillStyle = "rgba(255,95,95,0.2)";
  ctx.fillRect(0, goalTop, 18, goalMouth);
  ctx.fillStyle = "rgba(100,175,255,0.2)";
  ctx.fillRect(w - 18, goalTop, 18, goalMouth);
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.strokeRect(0, goalTop, 18, goalMouth);
  ctx.strokeRect(w - 18, goalTop, 18, goalMouth);

  // Queda natural da mesa: as pontas ficam mais escuras e setas apontam aos gols.
  const slope = ctx.createLinearGradient(0, 0, w, 0);
  slope.addColorStop(0, "rgba(0,0,0,0.16)");
  slope.addColorStop(0.5, "rgba(255,255,255,0.03)");
  slope.addColorStop(1, "rgba(0,0,0,0.16)");
  ctx.fillStyle = slope;
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.strokeStyle = "#eaffd0";
  ctx.lineWidth = 2;
  for (const y of [h * 0.28, h * 0.72]) {
    ctx.beginPath();
    ctx.moveTo(78, y); ctx.lineTo(58, y - 6);
    ctx.moveTo(78, y); ctx.lineTo(58, y + 6);
    ctx.moveTo(w - 78, y); ctx.lineTo(w - 58, y - 6);
    ctx.moveTo(w - 78, y); ctx.lineTo(w - 58, y + 6);
    ctx.stroke();
  }
  ctx.restore();
}

/** Roletada: aviso de que o manete está travado enquanto a bola dispara. */
function drawMovementLock(ctx: CanvasRenderingContext2D, match: MatchState): void {
  const color = ABILITY_COLORS.roletada ?? "#b28cff";
  const remaining = Math.max(0, (match.lockMovementUntilMs - match.nowMs) / 1000).toFixed(1);
  ctx.save();
  for (const rod of match.rods) {
    if (rod.side !== "left") continue;
    const x = rod.xRatio * match.field.width;
    ctx.fillStyle = "rgba(10,8,20,0.85)";
    ctx.beginPath(); ctx.arc(x, 24, 13, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = hexToRgba(color, 0.95);
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = "900 13px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("✕", x, 24);
  }
  ctx.fillStyle = hexToRgba(color, 0.95);
  ctx.font = "900 14px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`MANETE TRAVADO ${remaining}s`, match.field.width / 2, match.field.height - 34);
  ctx.restore();
}

/** Fogo nas bordas da arena quando a partida fica sem gol por muito tempo. */
function drawArenaFire(ctx: CanvasRenderingContext2D, w: number, h: number, heat: number): void {
  const t = performance.now() / 1000;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";

  const flame = (x: number, y: number, scale: number, phase: number): void => {
    const flick = 1 + Math.sin(t * 9 + phase) * 0.22 + Math.sin(t * 15 + phase * 1.7) * 0.12;
    const height = (14 + 26 * heat) * scale * flick;
    const width = 7 * scale;
    const grad = ctx.createLinearGradient(x, y + 4, x, y - height);
    grad.addColorStop(0, hexToRgba("#ff3d2e", 0.6 * heat));
    grad.addColorStop(0.45, hexToRgba("#ff8a3d", 0.4 * heat));
    grad.addColorStop(1, hexToRgba("#ffe066", 0.05 * heat));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(x - width, y + 4);
    ctx.quadraticCurveTo(x - width * 0.7 + Math.sin(t * 7 + phase) * 3, y - height * 0.55, x, y - height);
    ctx.quadraticCurveTo(x + width * 0.7 + Math.sin(t * 6 + phase) * 3, y - height * 0.55, x + width, y + 4);
    ctx.closePath();
    ctx.fill();
  };

  for (let x = 14; x < w - 8; x += 34) {
    flame(x, 6, 0.85 + Math.sin(x / 53) * 0.15, x / 60);
    flame(x, h - 6, 0.85 + Math.cos(x / 47) * 0.15, x / 43 + 1.3);
  }
  for (let y = 30; y < h - 24; y += 52) {
    flame(6, y, 0.72, y / 38);
    flame(w - 6, y, 0.72, y / 31 + 2.1);
  }

  const glow = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.18, w / 2, h / 2, Math.max(w, h) * 0.72);
  glow.addColorStop(0, "rgba(255,90,40,0)");
  glow.addColorStop(1, hexToRgba("#ff5a28", 0.12 * heat));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

/** Auras persistentes das habilidades defensivas ativas. */
function drawAbilityFields(ctx: CanvasRenderingContext2D, match: MatchState): void {
  const t = performance.now();

  // Mão Grande: luva gigante pulsando ao redor do goleiro.
  const goalie = match.rods.find((r) => r.side === "left" && r.id === "goleiro");
  if (goalie) {
    const mods = getHeroModifiers(match, "goleiro");
    if (mods.bigHand && mods.bigHandRadius > 0) {
      const x = goalie.xRatio * match.field.width;
      const y = getRodFiguresY(goalie, match.field.height)[0] ?? match.field.height / 2;
      const color = ABILITY_COLORS.mao_grande ?? "#8affc1";
      const pulse = 1 + Math.sin(t / 170) * 0.07;
      const radius = Math.max(30, 20 + mods.bigHandRadius * 1.7) * pulse;
      ctx.save();
      const aura = ctx.createRadialGradient(x, y, 4, x, y, radius);
      aura.addColorStop(0, hexToRgba(color, 0.36));
      aura.addColorStop(0.6, hexToRgba(color, 0.14));
      aura.addColorStop(1, hexToRgba(color, 0));
      ctx.fillStyle = aura;
      ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = hexToRgba(color, 0.7);
      ctx.lineWidth = 2;
      ctx.setLineDash([7, 6]);
      ctx.lineDashOffset = -t / 40;
      ctx.beginPath(); ctx.arc(x, y, radius * 0.82, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
  }

  // Zaga Magnética: campo suave em volta de cada boneco da barra válida.
  for (const rodId of ["goleiro", "defesa"] as const) {
    const rod = match.rods.find((r) => r.side === "left" && r.id === rodId);
    if (!rod) continue;
    const mods = getHeroModifiers(match, rodId);
    if (!mods.magnetic || mods.magnetRadius <= 0) continue;
    const color = ABILITY_COLORS.zaga_magnetica ?? "#5ee0ff";
    const x = rod.xRatio * match.field.width;
    const radius = Math.min(230, mods.magnetRadius);

    for (const y of getRodFiguresY(rod, match.field.height)) {
      ctx.save();
      const field = ctx.createRadialGradient(x, y, 8, x, y, radius);
      field.addColorStop(0, hexToRgba(color, 0.16));
      field.addColorStop(0.45, hexToRgba(color, 0.06));
      field.addColorStop(1, hexToRgba(color, 0));
      ctx.fillStyle = field;
      ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = hexToRgba(color, 0.24);
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 10]);
      ctx.lineDashOffset = -t / 55;
      ctx.beginPath(); ctx.arc(x, y, radius * 0.55, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
  }

  // Rebote: brilho nos bonecos que estão prontos para o contra-ataque.
  if (match.reboteCounterAvailable) {
    const color = ABILITY_COLORS.rebote ?? "#7cffb2";
    for (const rodId of ["goleiro", "defesa"] as const) {
      const rod = match.rods.find((r) => r.side === "left" && r.id === rodId);
      if (!rod) continue;
      const mods = getHeroModifiers(match, rodId);
      if (!mods.rebote) continue;
      const x = rod.xRatio * match.field.width;
      for (const y of getRodFiguresY(rod, match.field.height)) {
        ctx.save();
        const aura = ctx.createRadialGradient(x, y, 4, x, y, 34);
        aura.addColorStop(0, hexToRgba(color, 0.3));
        aura.addColorStop(1, hexToRgba(color, 0));
        ctx.fillStyle = aura;
        ctx.beginPath(); ctx.arc(x, y, 34, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = hexToRgba(color, 0.65 + 0.3 * Math.sin(t / 120));
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.lineDashOffset = -t / 35;
        ctx.beginPath(); ctx.arc(x, y, 24, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
    }
  }
}

/** Elástico: órbita visível enquanto a bola "rodeia" o atacante. */
function drawElasticOrbit(ctx: CanvasRenderingContext2D, elastic: ElasticState, nowMs: number): void {
  const color = elastic.color;
  ctx.save();
  ctx.translate(elastic.centerX, elastic.figureY);
  ctx.strokeStyle = hexToRgba(color, 0.75);
  ctx.lineWidth = 2;
  ctx.setLineDash([7, 7]);
  ctx.lineDashOffset = -nowMs / 45;
  ctx.beginPath(); ctx.arc(0, 0, elastic.radius, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  for (let i = 0; i < 3; i += 1) {
    const a = (i * Math.PI * 2) / 3 + nowMs / 220;
    ctx.fillStyle = hexToRgba(color, 0.9);
    ctx.beginPath();
    ctx.arc(Math.cos(a) * elastic.radius, Math.sin(a) * elastic.radius, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  ctx.save();
  ctx.fillStyle = hexToRgba(color, 0.9);
  ctx.font = "800 12px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("ELÁSTICO", elastic.centerX, elastic.figureY - elastic.radius - 12);
  ctx.restore();
}

function drawEffects(ctx: CanvasRenderingContext2D, effects: KickEffect[]): void {
  for (const fx of effects) {
    const t = Math.min(1, fx.ageMs / fx.lifeMs);
    const alpha = 1 - t;
    ctx.save();

    if (fx.kind === "ability") {
      ctx.translate(fx.x, fx.y);
      ctx.rotate(t * 1.3);
      ctx.strokeStyle = hexToRgba(fx.color, alpha);
      ctx.lineWidth = 3;
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        const r0 = 12 + t * 14;
        const r1 = 30 + t * 42;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
        ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
        ctx.stroke();
      }
      ctx.rotate(-t * 1.3);
      if (fx.label) {
        ctx.fillStyle = hexToRgba(fx.color, alpha);
        ctx.font = "800 16px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(fx.label, 0, -(46 + t * 18));
      }
    } else if (fx.kind === "goal") {
      ctx.strokeStyle = hexToRgba(fx.color, alpha * 0.8);
      ctx.lineWidth = 5 * alpha + 1;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(fx.x, fx.y, 16 + i * 18 + t * 70, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (fx.label) {
        ctx.fillStyle = hexToRgba(fx.color, alpha);
        ctx.font = "900 34px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(fx.label, fx.x, fx.y - 70 - t * 20);
      }
    } else if (fx.kind === "miss") {
      ctx.strokeStyle = hexToRgba(fx.color, alpha * 0.5);
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(fx.x, fx.y, 8 + t * 12, 0, Math.PI * 2); ctx.stroke();
    } else {
      ctx.strokeStyle = hexToRgba(fx.color, alpha * 0.75);
      ctx.lineWidth = 2 + (1 - t) * 3;
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, 10 + t * (46 + fx.power * 34), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}

/** Aviso temporário explicando o que a habilidade fez. */
function drawToast(ctx: CanvasRenderingContext2D, toast: MatchToast): void {
  const t = toast.ageMs / toast.lifeMs;
  const alpha = t < 0.08 ? t / 0.08 : t > 0.78 ? (1 - t) / 0.22 : 1;
  const x = 24;
  const y = 76;
  const w = 340;
  const h = 54;
  ctx.save();
  ctx.globalAlpha = Math.max(0, alpha);
  ctx.fillStyle = "rgba(8,10,18,0.88)";
  roundRect(ctx, x, y, w, h, 12);
  ctx.fill();
  ctx.strokeStyle = hexToRgba(toast.color, 0.95);
  ctx.lineWidth = 2;
  roundRect(ctx, x, y, w, h, 12);
  ctx.stroke();
  ctx.fillStyle = toast.color;
  roundRect(ctx, x, y + 9, 4, h - 18, 2);
  ctx.fill();

  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = toast.color;
  ctx.font = "800 16px system-ui, sans-serif";
  ctx.fillText(toast.title, x + 16, y + 18);
  ctx.fillStyle = "rgba(235,240,250,0.92)";
  ctx.font = "600 11px system-ui, sans-serif";
  ctx.fillText(toast.detail, x + 16, y + 38);
  ctx.restore();
}

function drawRods(
  ctx: CanvasRenderingContext2D,
  rods: RodState[],
  w: number,
  h: number,
  selectedRodId?: string,
  previewAbilityId?: string | null,
  rodFx?: Map<string, RodFx>,
): void {
  const preview = previewAbilityId ? getAbility(previewAbilityId) : null;
  const pulse = 12 + Math.sin(performance.now() / 150) * 6;

  for (const rod of rods) {
    const x = rod.xRatio * w;
    const selected = rod.side === "left" && rod.id === selectedRodId;
    const isPreviewTarget = !!preview && rod.side === "left" && preview.allowedRods.includes(rod.id);
    const dimmed = !!preview && rod.side === "left" && !isPreviewTarget;
    const fx = rod.side === "left" ? rodFx?.get(rod.id) : undefined;

    if (dimmed) {
      ctx.save();
      ctx.globalAlpha = 0.35;
    }

    ctx.strokeStyle = fx
      ? hexToRgba(fx.color, fx.armed ? 0.85 : 1)
      : isPreviewTarget ? "rgba(255,205,110,0.95)" : selected ? "rgba(255,255,255,0.95)" : "rgba(215,225,235,0.55)";
    ctx.lineWidth = fx ? (fx.armed ? 7 : 9) : isPreviewTarget ? 9 : selected ? 7 : 5;
    if (fx || isPreviewTarget) {
      ctx.shadowColor = fx ? fx.color : "rgba(255,160,50,0.9)";
      ctx.shadowBlur = fx ? (fx.armed ? 10 + pulse * 0.4 : 18 + pulse) : pulse;
    }
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    ctx.shadowBlur = 0;

    if (fx) {
      ctx.fillStyle = fx.color;
      ctx.globalAlpha *= fx.armed ? 0.5 + 0.4 * Math.sin(performance.now() / 140) : 1;
      ctx.beginPath(); ctx.arc(x, 16, fx.armed ? 5 : 7, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = dimmed ? 0.35 : 1;
    }

    if (isPreviewTarget) {
      ctx.fillStyle = "rgba(255,220,140,0.95)";
      ctx.beginPath(); ctx.arc(x, 38, 12, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#3a2408";
      ctx.font = "900 14px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("✓", x, 38);
    }

    for (const y of getRodFiguresY(rod, h)) {
      drawFigure(ctx, x, y, rod.kickAngle, rod.color, rod.side, selected || isPreviewTarget, rod.charge, fx?.color);
    }
    if (dimmed) ctx.restore();
  }
}

function drawFigure(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  color: string,
  side: "left" | "right",
  selected: boolean,
  charge: number,
  abilityColor?: string,
): void {
  ctx.save();
  ctx.translate(x, y);
  const dir = side === "left" ? 1 : -1;
  ctx.rotate(angle * 0.35);

  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.beginPath(); ctx.ellipse(0, 12, 10, 4, 0, 0, Math.PI * 2); ctx.fill();

  ctx.fillStyle = abilityColor ?? color;
  ctx.strokeStyle = selected ? "#ffffff" : "rgba(255,255,255,0.35)";
  ctx.lineWidth = selected ? 2 : 1;
  roundRect(ctx, -9, -16, 18, 24, 6);
  ctx.fill(); ctx.stroke();

  ctx.fillStyle = "#f3d2b5";
  ctx.beginPath(); ctx.arc(0, -22, 7, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.15)";
  ctx.stroke();

  // Perna e bota — é esta parte que encosta na bola no modelo de colisão.
  const kickExt = Math.sin(Math.abs(angle)) * 10;
  const footX = (10 + kickExt) * dir;
  ctx.strokeStyle = selected ? "#fff" : "rgba(255,255,255,0.75)";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(0, 6);
  ctx.lineTo(footX, 16);
  ctx.stroke();
  ctx.fillStyle = selected ? "#ffffff" : "#dbe6f2";
  ctx.beginPath();
  ctx.ellipse(footX + 2 * dir, 16, 7, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.3)";
  ctx.lineWidth = 1;
  ctx.stroke();

  if (charge > 0) {
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, -2, 18, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * charge); ctx.stroke();
  }
  ctx.restore();
}

function drawBall(
  ctx: CanvasRenderingContext2D,
  ball: MatchState["ball"],
  glowColor?: string,
): void {
  const x = ball.pos.x;
  const y = ball.pos.y;
  const r = ball.radius;
  const roll = ball.roll;
  const speed = Math.hypot(ball.vel.x, ball.vel.y);

  // Cruzador Estelar: mostra a trajetória "travada" e o giro que não morre.
  if (ball.guideRemainingMs > 0 && Math.hypot(ball.guideVx, ball.guideVy) > 1) {
    const len = Math.hypot(ball.guideVx, ball.guideVy);
    const gx = ball.guideVx / len;
    const gy = ball.guideVy / len;
    const color = ABILITY_COLORS.cruzador_estelar!;
    ctx.save();
    ctx.setLineDash([8, 6]);
    ctx.lineDashOffset = -performance.now() / 45;
    ctx.strokeStyle = hexToRgba(color, 0.55);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + gx * 100, y + gy * 100);
    ctx.stroke();
    ctx.setLineDash([]);
    const orbit = performance.now() / 85;
    for (let i = 0; i < 3; i++) {
      const a = orbit + (i * Math.PI * 2) / 3;
      ctx.fillStyle = hexToRgba(color, 0.9);
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * (r + 7), y + Math.sin(a) * (r + 7), 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Chute Fantasma: uma cópia translúcida na direção da finta e o arco de volta.
  if (ball.phantomRemainingMs > 0) {
    const color = ABILITY_COLORS.chute_fantasma!;
    const vlen = speed || 1;
    const fx = ball.vel.x / vlen;
    const fy = ball.vel.y / vlen;
    const gx = x + fx * 20;
    const gy = y + fy * 20;
    ctx.save();
    ctx.strokeStyle = hexToRgba(color, 0.75);
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 5]);
    ctx.beginPath();
    ctx.moveTo(gx, gy);
    ctx.quadraticCurveTo(gx - fy * 26, gy + fx * 26, x - fx * 34, y - fy * 34);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    ctx.arc(gx, gy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }

  // Chute de Goleiro: enquanto o gol está "limpo", a bola vale 2 pontos.
  if (ball.untouchedGoalKick) {
    const color = ABILITY_COLORS.chute_goleiro ?? "#ff9f43";
    ctx.save();
    ctx.strokeStyle = hexToRgba(color, 0.9);
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.lineDashOffset = -performance.now() / 40;
    ctx.beginPath(); ctx.arc(x, y, r + 9, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = hexToRgba(color, 0.95);
    ctx.font = "900 12px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("×2", x, y - r - 14);
    ctx.restore();
  }

  // Chute Relâmpago: zigue-zague elétrico na direção da quina.
  if (ball.lightningBounce) {
    const color = ABILITY_COLORS.chute_relampago ?? "#f6ff6b";
    ctx.save();
    ctx.strokeStyle = hexToRgba(color, 0.85);
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let i = 1; i <= 5; i += 1) {
      ctx.lineTo(x - i * 15, y + (i % 2 === 0 ? 9 : -9));
    }
    ctx.stroke();
    ctx.restore();
  }

  // Força Bruta: espinhos e vibração vermelha enquanto a bola quica elástica.
  if (ball.bruteMs > 0) {
    const color = ABILITY_COLORS.forca_bruta ?? "#ff5d5d";
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(roll * 0.6);
    ctx.strokeStyle = hexToRgba(color, 0.7);
    ctx.lineWidth = 2;
    for (let i = 0; i < 8; i += 1) {
      const a = (i * Math.PI) / 4;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * (r + 3), Math.sin(a) * (r + 3));
      ctx.lineTo(Math.cos(a) * (r + 12 + Math.sin(performance.now() / 60 + i) * 3), Math.sin(a) * (r + 12));
      ctx.stroke();
    }
    ctx.restore();
  }

  // Bola flamejante quando a arena esquenta.
  if (ball.heat > 0) {
    const nx = speed > 1 ? ball.vel.x / speed : -1;
    const ny = speed > 1 ? ball.vel.y / speed : 0;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const halo = ctx.createRadialGradient(x, y, r * 0.4, x, y, r + 16 * ball.heat);
    halo.addColorStop(0, hexToRgba("#ffe066", 0.35 * ball.heat));
    halo.addColorStop(1, hexToRgba("#ff4d2e", 0));
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(x, y, r + 16 * ball.heat, 0, Math.PI * 2); ctx.fill();
    for (let i = 0; i < 5; i += 1) {
      const t = performance.now() / 90 + i * 1.3;
      const back = r + 5 + i * 7 * ball.heat;
      const spread = Math.sin(t) * 5 * ball.heat;
      ctx.fillStyle = hexToRgba(i % 2 ? "#ff5a28" : "#ffb03a", (0.7 - i * 0.1) * ball.heat);
      ctx.beginPath();
      ctx.arc(x - nx * back - ny * spread, y - ny * back + nx * spread, (5 - i * 0.6) * ball.heat + 1, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  if (speed > 80) {
    const nx = ball.vel.x / speed;
    const ny = ball.vel.y / speed;
    ctx.strokeStyle = glowColor ? hexToRgba(glowColor, 0.4) : "rgba(255,255,255,0.25)";
    ctx.lineWidth = r * 1.4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x - nx * Math.min(34, speed * 0.045), y - ny * Math.min(34, speed * 0.045));
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(roll);
  ctx.fillStyle = "#f7fafc";
  ctx.shadowColor = glowColor ?? "rgba(0,0,0,0.35)";
  ctx.shadowBlur = glowColor ? 22 : 10;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = glowColor ? hexToRgba(glowColor, 0.35) : "rgba(70,85,110,0.2)";
  for (let i = 0; i < 5; i++) {
    const a = (i * Math.PI * 2) / 5;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5, r * 0.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  ctx.strokeStyle = "rgba(80,90,110,0.35)";
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
}

function drawScore(ctx: CanvasRenderingContext2D, left: number, right: number, w: number, stage: number): void {
  const g = ctx.createLinearGradient(w / 2 - 78, 0, w / 2 + 78, 0);
  g.addColorStop(0, "rgba(90,180,255,0.35)");
  g.addColorStop(0.5, "rgba(10,14,20,0.72)");
  g.addColorStop(1, "rgba(255,120,90,0.35)");
  ctx.fillStyle = g;
  roundRect(ctx, w / 2 - 78, 18, 156, 52, 12);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = "700 27px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`${left}  ×  ${right}`, w / 2, 37);
  ctx.fillStyle = "rgba(255,210,140,0.9)";
  ctx.font = "900 9px system-ui, sans-serif";
  ctx.fillText(`STACK ${stage} · VENCE POR 3`, w / 2, 57);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const rgb = clean.slice(0, 6);
  const full = rgb.length === 3 ? rgb.split("").map((c) => c + c).join("") : rgb;
  const num = parseInt(full, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}
