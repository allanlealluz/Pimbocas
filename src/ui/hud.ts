import { ABILITY_COLORS, getAbility } from "../domain/abilities";
import { getAbilityViews } from "../game/ability-system";
import { getEquippedAbilityIds, type MatchState } from "../game/match";

function byId<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

// Evita recriar os nós a cada frame — necessário para hover/foco funcionarem.
const lastHtml: Record<string, string> = {};
function setHtml(id: string, el: HTMLElement | null, html: string): void {
  if (!el || lastHtml[id] === html) return;
  el.innerHTML = html;
  lastHtml[id] = html;
}

export interface HudContext {
  previewAbilityId: string | null;
}

export function renderHud(match: MatchState, ctx: HudContext): void {
  const { hero, abilitySystem } = match.localPlayer;
  const barEl = byId<HTMLDivElement>("special-bar");
  const markersEl = byId<HTMLDivElement>("ability-markers");

  const { current, max, segments } = abilitySystem.bar;
  const pct = max > 0 ? Math.min(100, (current / max) * 100) : 0;

  if (barEl) {
    // Divisórias dos segmentos variáveis (de baixo para cima).
    let acc = 0;
    const dividers: string[] = [];
    for (const size of segments) {
      acc += size;
      if (acc < max) {
        dividers.push(`<div class="thermo-segment" style="bottom:${((acc / max) * 100).toFixed(2)}%"></div>`);
      }
    }

    // Marcações das habilidades na altura do custo acumulado.
    const marks = hero.abilities
      .map((id) => {
        const ability = getAbility(id);
        const reached = current >= ability.cost;
        const top = ((ability.cost / max) * 100).toFixed(2);
        return `<div class="thermo-mark ${reached ? "reached" : ""}" style="bottom:${top}%"></div>`;
      })
      .join("");

    setHtml("thermo", barEl, `
      <div class="thermo-tube">
        <div class="thermo-liquid" style="height:${pct.toFixed(2)}%"></div>
        ${dividers.join("")}
        ${marks}
      </div>
      <div class="thermo-bulb"></div>
    `);
  }

  if (markersEl) {
    const views = getAbilityViews(abilitySystem, match.nowMs);
    setHtml("markers", markersEl, getEquippedAbilityIds(match)
      .map((abilityId) => {
        const ability = getAbility(abilityId);
        const runtime = abilitySystem.abilities[abilityId];
        const bottomPct = max > 0 ? ((ability.cost / max) * 100).toFixed(2) : "0";
        const view = views.find((v) => v.ability.id === abilityId);
        const classes = [
          ctx.previewAbilityId === abilityId ? "preview" : "",
          view?.active ? "active" : "",
          view?.armed ? "armed" : "",
          runtime?.borrowed ? "borrowed" : "",
          runtime?.cooldownRemainingMs ? "cooling" : "",
        ].filter(Boolean).join(" ");
        return `
          <div class="ability-marker ${classes}" data-preview-ability="${ability.id}"
               style="bottom:${bottomPct}%;color:${runtime?.borrowed ? (ABILITY_COLORS.copia ?? "#ffe7a3") : (ABILITY_COLORS[abilityId] ?? "#ffd9a0")}" tabindex="0" role="button" aria-label="${runtime?.borrowed ? "Cópia: " : ""}${ability.name}">
            ${runtime?.borrowed ? "↳ " : ""}${ability.name}
          </div>
        `;
      })
      .join(""));
  }

  // Painel do adversário: mostra de qual herói ele está usando as habilidades.
  const { hero: aiHero, abilitySystem: aiSystem } = match.aiPlayer;
  const aiNameEl = byId<HTMLSpanElement>("ai-energy-name");
  const aiValueEl = byId<HTMLSpanElement>("ai-energy-value");
  const aiFillEl = byId<HTMLDivElement>("ai-energy-fill");
  const aiAbilitiesEl = byId<HTMLDivElement>("ai-energy-abilities");
  const aiPct = aiSystem.bar.max > 0 ? Math.min(100, (aiSystem.bar.current / aiSystem.bar.max) * 100) : 0;

  if (aiNameEl && aiNameEl.textContent !== aiHero.name) aiNameEl.textContent = aiHero.name;
  if (aiValueEl) {
    const text = `${Math.round(aiPct)}%`;
    if (aiValueEl.textContent !== text) aiValueEl.textContent = text;
  }
  if (aiFillEl) aiFillEl.style.width = `${aiPct.toFixed(1)}%`;
  if (aiAbilitiesEl) {
    const aiViews = getAbilityViews(aiSystem, match.nowMs);
    const html = getEquippedAbilityIds(match, match.aiPlayer)
      .map((abilityId) => {
        const ability = getAbility(abilityId);
        const view = aiViews.find((v) => v.ability.id === abilityId);
        const cls = view?.active ? "active"
          : view?.armed ? "ready"
            : aiSystem.bar.current >= ability.cost ? "ready" : "";
        return `<span class="ai-energy-chip ${cls}">${ability.name}</span>`;
      })
      .join("");
    setHtml("ai-abilities", aiAbilitiesEl, html);
  }
}
