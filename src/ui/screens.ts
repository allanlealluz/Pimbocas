import { ABILITIES, ABILITY_COLORS } from "../domain/abilities";
import { listHeroes } from "../domain/heroes";
import { ROLE_CHARGE_SUMMARY } from "../domain/roles";
import { STAT_BUDGET, STAT_MAX, STAT_MIN, STAT_REFERENCE, STAT_STEP } from "../domain/stats";
import type { HeroDefinition, HeroStats, Role } from "../domain/types";
import type { AiDifficulty } from "../game/match";
import type { PlayerProfile } from "../net/firebase";

export type ScreenName = "auth" | "menu" | "modes" | "select" | "creator" | "howto" | "game";
export type AuthMode = "login" | "register";

export { STAT_BUDGET, STAT_MIN, STAT_MAX };

export const ROLE_LABELS: Record<Role, string> = {
  ofensivo: "Ofensivo",
  defensivo: "Defensivo",
  coringa: "Coringa",
};

export const DIFFICULTY_LABELS: Record<AiDifficulty, { name: string; detail: string }> = {
  facil: { name: "Fácil", detail: "IA mais lenta, erra mais chutes." },
  medio: { name: "Médio", detail: "Ritmo equilibrado de partida." },
  dificil: { name: "Difícil", detail: "IA rápida e mais precisa." },
};

export const STAT_LABELS: Record<keyof HeroStats, string> = {
  kickPower: "Chute",
  ballControl: "Controle",
  rodSpeed: "Velocidade",
  defense: "Defesa",
  goalkeeping: "Goleiro",
};

export const STAT_DESCRIPTIONS: Record<keyof HeroStats, string> = {
  kickPower: "Força do chute: quanto maior, mais rápida a bola sai do pé.",
  ballControl: "Controle: quão fácil o boneco trava a bola com ele (menos rebote).",
  rodSpeed: "Velocidade: quão rápido a barra selecionada se move.",
  defense: "Defesa: drena a velocidade da bola quando ela bate em você.",
  goalkeeping: "Goleiro: alcance e pegada extras só na barra do goleiro (mais cobertura e menos devolução).",
};

export const STAT_KEYS = Object.keys(STAT_LABELS) as (keyof HeroStats)[];

export const BAR_PRESETS = [
  { id: "rapido", label: "4 segmentos", detail: "ciclos rápidos", segments: [25, 25, 25, 25] },
  { id: "tatico", label: "3 segmentos", detail: "equilíbrio", segments: [20, 30, 50] },
  { id: "pesado", label: "2 segmentos", detail: "habilidades pesadas", segments: [50, 50] },
  { id: "curto", label: "2 segmentos", detail: "carga irregular", segments: [40, 60] },
] as const;

export type BarPresetId = (typeof BAR_PRESETS)[number]["id"];

export interface HeroDraft {
  id?: string;
  name: string;
  role: Role;
  color: string;
  stats: HeroStats;
  barPreset: BarPresetId;
  abilities: string[];
}

export const HERO_COLORS = ["#ff9f43", "#6fd7ff", "#c792ff", "#8affc1", "#ff5d8f", "#ffd166"];

export function createHeroDraft(): HeroDraft {
  return {
    name: "",
    role: "coringa",
    color: HERO_COLORS[2]!,
    stats: { kickPower: 30, ballControl: 30, rodSpeed: 30, defense: 30, goalkeeping: 30 },
    barPreset: "tatico",
    abilities: ["leitura_de_jogo"],
  };
}

export function draftFromHero(hero: HeroDefinition): HeroDraft {
  const key = hero.specialBar.segments.join(",");
  const preset = BAR_PRESETS.find((p) => p.segments.join(",") === key);
  return {
    id: hero.id,
    name: hero.name,
    role: hero.role,
    color: hero.color ?? HERO_COLORS[2]!,
    stats: { ...hero.stats },
    barPreset: preset?.id ?? "tatico",
    abilities: [...hero.abilities],
  };
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!
  ));
}

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0] ?? "").join("").toUpperCase() || "?";
}

export function heroAvatar(hero: { name: string; color?: string }, cssClass = ""): string {
  const color = hero.color ?? (hero.name === "Rafa Artilheiro" ? HERO_COLORS[0]! : hero.name === "Duda Muralha" ? HERO_COLORS[1]! : HERO_COLORS[2]!);
  return `<span class="hero-avatar ${cssClass}" style="--hero-color:${color}"><span>${escapeHtml(initials(hero.name))}</span></span>`;
}

function statBars(stats: HeroStats, compact = false): string {
  return `<div class="stat-bars ${compact ? "compact" : ""}">${STAT_KEYS.map((key) => `
    <div class="stat-row" title="${STAT_DESCRIPTIONS[key]}">
      <span>${STAT_LABELS[key]}</span>
      <div class="stat-track"><i style="width:${stats[key]}%"></i></div>
      <b>${stats[key]}</b>
    </div>`).join("")}</div>`;
}

function abilityChips(hero: HeroDefinition): string {
  return hero.abilities.map((id) => {
    const ability = ABILITIES[id];
    if (!ability) return "";
    return `<span class="ability-chip" style="--chip-color:${ABILITY_COLORS[id] ?? "#ffd9a0"}">${escapeHtml(ability.name)}</span>`;
  }).join("");
}

function heroCard(hero: HeroDefinition, selected: boolean): string {
  const segments = hero.specialBar.segments.join(" · ");
  return `
    <article class="hero-card ${selected ? "selected" : ""}" style="--hero-color:${hero.color ?? HERO_COLORS[2]!}">
      <div class="hero-card-head">
        ${heroAvatar(hero)}
        <div>
          <span class="role-badge">${ROLE_LABELS[hero.role]}</span>
          <h3>${escapeHtml(hero.name)}</h3>
        </div>
        ${hero.custom ? '<span class="custom-badge">CRIADO</span>' : ""}
      </div>
      <p class="hero-desc">${escapeHtml(hero.description)}</p>
      ${statBars(hero.stats, true)}
      <div class="hero-bar-info"><span>Barra</span><b>${segments}</b></div>
      <div class="ability-chips">${abilityChips(hero)}</div>
      <div class="hero-card-actions">
        <button type="button" class="btn ${selected ? "selected-btn" : "primary"} btn-sm" data-select-hero="${escapeHtml(hero.id)}">
          ${selected ? "Selecionado" : "Escolher"}
        </button>
        ${hero.custom ? `
          <button type="button" class="btn ghost btn-sm" data-edit-hero="${escapeHtml(hero.id)}">Editar</button>
          <button type="button" class="btn danger-text btn-sm" data-delete-hero="${escapeHtml(hero.id)}">Excluir</button>
        ` : ""}
      </div>
    </article>`;
}

function brand(): string {
  return `<div class="brand"><span class="brand-icon">P</span><div><strong>PIMBOCAS</strong><small>Pebolim Heroes</small></div></div>`;
}

function appHeader(profile: PlayerProfile): string {
  return `
    <header class="app-header">
      ${brand()}
      <div class="header-right">
        <span class="user-chip">${heroAvatar({ name: profile.displayName, color: HERO_COLORS[4]! }, "tiny")}<span>${escapeHtml(profile.displayName)}</span></span>
        <button type="button" class="btn ghost btn-sm" data-action="logout">Sair</button>
      </div>
    </header>`;
}

export function authScreen(mode: AuthMode): string {
  const registering = mode === "register";
  return `
    <section class="screen auth-screen">
      <div class="auth-bg-orb orb-one"></div><div class="auth-bg-orb orb-two"></div>
      <div class="auth-card">
        <div class="auth-brand">${brand()}</div>
        <h1>${registering ? "Crie sua conta" : "Bem-vindo de volta"}</h1>
        <p class="auth-subtitle">${registering ? "Escolha seu personagem e entre na mesa." : "Entre para jogar, criar heróis e salvar seu progresso."}</p>
        <div class="auth-tabs">
          <button type="button" data-auth-tab="login" class="${registering ? "" : "active"}">Entrar</button>
          <button type="button" data-auth-tab="register" class="${registering ? "active" : ""}">Criar conta</button>
        </div>
        <form data-form="auth" class="auth-form">
          ${registering ? `<label>Nome de jogador<input name="name" type="text" maxlength="24" placeholder="Seu apelido" required autocomplete="nickname"></label>` : ""}
          <label>E-mail<input name="email" type="email" placeholder="voce@email.com" required autocomplete="email"></label>
          <label>Senha<input name="password" type="password" minlength="6" placeholder="mínimo 6 caracteres" required autocomplete="${registering ? "new-password" : "current-password"}"></label>
          <button class="btn primary btn-wide" type="submit">${registering ? "Criar conta" : "Entrar"}</button>
        </form>
        <div class="auth-divider"><span>ou continue assim</span></div>
        <div class="auth-alt">
          <button type="button" class="btn outline btn-wide" data-action="google">Continuar com Google</button>
          <div class="auth-alt-row">
            <button type="button" class="btn ghost btn-sm" data-action="guest">Entrar como convidado</button>
            <button type="button" class="btn ghost btn-sm" data-action="local">Jogar sem conta</button>
          </div>
        </div>
        <p class="form-error" data-error></p>
      </div>
    </section>`;
}

export function menuScreen(profile: PlayerProfile): string {
  let hero: HeroDefinition;
  try { hero = listHeroes().find((h) => h.id === profile.selectedHeroId) ?? listHeroes()[0]!; }
  catch { hero = listHeroes()[0]!; }
  return `
    <section class="screen menu-screen">
      ${appHeader(profile)}
      <div class="menu-content">
        <div class="menu-headline">
          <span class="eyebrow">Mesa 01 · PE BOLIM LIGA</span>
          <h1>Seu herói.<br><em>Sua mesa.</em></h1>
          <p>Monte seu estilo, escolha suas habilidades e entre no jogo. Por enquanto, o adversário é a IA.</p>
          <button type="button" class="btn primary btn-hero" data-action="play">Jogar <span>→</span></button>
        </div>
        <div class="menu-side">
          <div class="menu-hero-card" style="--hero-color:${hero.color ?? HERO_COLORS[2]!}">
            <span class="menu-label">PERSONAGEM ATUAL</span>
            ${heroAvatar(hero, "large")}
            <h2>${escapeHtml(hero.name)}</h2>
            <span class="role-badge">${ROLE_LABELS[hero.role]}</span>
            <div class="ability-chips">${abilityChips(hero)}</div>
            <button type="button" class="btn ghost btn-sm" data-action="select">Trocar personagem</button>
          </div>
          <div class="menu-links">
            <button type="button" data-action="creator"><b>+</b> Criar personagem</button>
            <button type="button" data-action="howto"><b>?</b> Como jogar</button>
          </div>
        </div>
      </div>
      <footer class="menu-footer">${profile.customHeroes.length} personagem(ns) criado(s) · MMR ${profile.mmr}</footer>
    </section>`;
}

export function selectScreen(profile: PlayerProfile): string {
  const heroes = listHeroes();
  return `
    <section class="screen select-screen">
      ${appHeader(profile)}
      <div class="screen-heading">
        <div>
          <span class="eyebrow">SELEÇÃO DE PERSONAGENS</span>
          <h1>Escolha seu herói</h1>
          <p>Cada personagem tem atributos, funções e uma barra de especial diferente.</p>
        </div>
        <button type="button" class="btn primary" data-action="creator">+ Criar personagem</button>
      </div>
      <div class="hero-grid">${heroes.map((hero) => heroCard(hero, hero.id === profile.selectedHeroId)).join("")}</div>
      <div class="screen-actions">
        <button type="button" class="btn ghost" data-action="menu">Voltar</button>
        <button type="button" class="btn primary" data-action="play">Continuar para o jogo →</button>
      </div>
      <p class="form-error" data-error></p>
    </section>`;
}

export function modesScreen(profile: PlayerProfile, difficulty: AiDifficulty): string {
  let hero: HeroDefinition;
  try { hero = listHeroes().find((h) => h.id === profile.selectedHeroId) ?? listHeroes()[0]!; }
  catch { hero = listHeroes()[0]!; }
  return `
    <section class="screen modes-screen">
      ${appHeader(profile)}
      <div class="screen-heading">
        <div>
          <span class="eyebrow">MODO DE JOGO</span>
          <h1>Como você quer jogar?</h1>
          <p>Escolha o modo e a dificuldade da partida.</p>
        </div>
        <button type="button" class="btn ghost" data-action="menu">Voltar</button>
      </div>
      <div class="mode-grid">
        <article class="mode-card available">
          <div class="mode-icon">🤖</div>
          <span class="mode-tag">DISPONÍVEL</span>
          <h2>Contra a IA</h2>
          <p>Partida solo no pebolim. Treine chutes, defesas e habilidades.</p>
          <div class="mode-selected">${heroAvatar(hero)}<span>${escapeHtml(hero.name)}</span><small>${ROLE_LABELS[hero.role]}</small></div>
        </article>
        <article class="mode-card locked">
          <div class="mode-icon">🌐</div>
          <span class="mode-tag">EM BREVE</span>
          <h2>Online 1v1</h2>
          <p>Pareamento com outros jogadores. Depende do transporte em tempo real.</p>
        </article>
        <article class="mode-card locked">
          <div class="mode-icon">🏆</div>
          <span class="mode-tag">EM BREVE</span>
          <h2>Torneio</h2>
          <p>Chave eliminatória com heróis e progressão de MMR.</p>
        </article>
      </div>
      <div class="difficulty-picker">
        <span>DIFICULDADE DA IA</span>
        <div class="difficulty-options">
          ${(Object.keys(DIFFICULTY_LABELS) as AiDifficulty[]).map((key) => `
            <button type="button" class="difficulty-option ${key === difficulty ? "active" : ""}" data-difficulty="${key}">
              <b>${DIFFICULTY_LABELS[key].name}</b><small>${DIFFICULTY_LABELS[key].detail}</small>
            </button>`).join("")}
        </div>
      </div>
      <div class="screen-actions">
        <button type="button" class="btn primary btn-hero" data-action="start-match">Começar partida →</button>
      </div>
    </section>`;
}

export function howToScreen(): string {
  return `
    <section class="screen howto-screen">
      ${`<header class="app-header"><div class="brand"><span class="brand-icon">P</span><div><strong>PIMBOCAS</strong><small>Pebolim Heroes</small></div></div><button type="button" class="btn ghost btn-sm" data-action="menu">Voltar</button></header>`}
      <div class="screen-heading"><div><span class="eyebrow">GUIA RÁPIDO</span><h1>Como jogar</h1></div></div>
      <div class="howto-grid">
        <div class="howto-card">
          <h2>Controles</h2>
          <div class="key-list">
            <div><kbd>Q</kbd><kbd>W</kbd><kbd>E</kbd><kbd>R</kbd><span>Selecionar goleiro, defesa, meio e ataque</span></div>
            <div><kbd>↑</kbd><kbd>↓</kbd><span>Mover a barra selecionada</span></div>
            <div><kbd>→</kbd><span>Segurar e soltar: chute para frente (força pela carga)</span></div>
            <div><kbd>←</kbd><span>Segurar e soltar: chute para trás</span></div>
            <div><kbd>1</kbd><kbd>-</kbd><kbd>4</kbd><span>Ativar habilidades (veja o nome no termômetro)</span></div>
            <div><kbd>Esc</kbd><span>Sair da partida</span></div>
          </div>
        </div>
        <div class="howto-card">
          <h2>Especial</h2>
          <p>A barra de fogo enche com o tempo e com suas ações. Cada habilidade fica marcada na altura do custo.</p>
          <p><b style="color:#ffd166">Auto-disparo:</b> se a bola estiver perto da barra da habilidade, ela <b>pega a bola e chuta sozinha</b> — não precisa segurar <kbd>→</kbd>. Se não estiver, a habilidade fica armada para o próximo chute.</p>
          <ul>
            <li><b style="color:${ABILITY_COLORS.chute_diagonal}">Chute Diagonal</b> — mais força e trajetória oblíqua.</li>
            <li><b style="color:${ABILITY_COLORS.bloqueio_pesado}">Bloqueio Pesado</b> — defesa rígida: a bola quase para nos pés.</li>
            <li><b style="color:${ABILITY_COLORS.leitura_de_jogo}">Leitura de Jogo</b> — 2s de barra mais rápida e chute mais forte.</li>
            <li><b style="color:${ABILITY_COLORS.cruzador_estelar}">Cruzador Estelar</b> — do meio: chute fortíssimo, giro longo e trajetória que atravessa a defesa.</li>
            <li><b style="color:${ABILITY_COLORS.chute_fantasma}">Chute Fantasma</b> — finta na diagonal oposta e curva de volta.</li>
            <li><b style="color:${ABILITY_COLORS.combo_breaker}">Combo Breaker</b> — 4 rechutes seguidos, com força crescente.</li>
          </ul>
        </div>
        <div class="howto-card">
          <h2>Atributos e carga</h2>
          <p>Cada personagem tem no máximo <b>${STAT_BUDGET} pontos</b> de atributo (${STAT_MIN} a ${STAT_MAX} cada). A referência de equilíbrio é ${STAT_REFERENCE}.</p>
          <ul>
            ${STAT_KEYS.map((key) => `<li><b>${STAT_LABELS[key]}</b> — ${STAT_DESCRIPTIONS[key]}</li>`).join("")}
          </ul>
          <p class="howto-charge">
            <b>Ofensivo:</b> ${ROLE_CHARGE_SUMMARY.ofensivo}<br>
            <b>Defensivo:</b> ${ROLE_CHARGE_SUMMARY.defensivo}<br>
            <b>Coringa:</b> ${ROLE_CHARGE_SUMMARY.coringa}
          </p>
        </div>
      </div>
    </section>`;
}

export function creatorScreen(profile: PlayerProfile, draft: HeroDraft): string {
  const editing = !!draft.id;
  const statsTotal = STAT_KEYS.reduce((sum, key) => sum + draft.stats[key], 0);
  return `
    <section class="screen creator-screen">
      ${appHeader(profile)}
      <div class="screen-heading">
        <div>
          <span class="eyebrow">CRIADOR DE PERSONAGEM</span>
          <h1>${editing ? "Editar personagem" : "Crie seu herói"}</h1>
          <p>Distribua os atributos, escolha a barra e até duas habilidades.</p>
        </div>
        <button type="button" class="btn ghost" data-action="select">Voltar</button>
      </div>
      <form data-form="creator" class="creator-panel">
        <div class="creator-grid">
          <div class="creator-column">
            <label class="field-label">Nome do personagem
              <input name="heroName" type="text" data-draft-input="name" maxlength="18" placeholder="Ex.: Néo Coringa" value="${escapeHtml(draft.name)}" required>
            </label>
            <label class="field-label">Função
              <select name="role" data-draft-input="role">
                ${(Object.keys(ROLE_LABELS) as Role[]).map((role) => `<option value="${role}" ${role === draft.role ? "selected" : ""}>${ROLE_LABELS[role]}</option>`).join("")}
              </select>
            </label>
            <div class="field-label">Cor do herói
              <div class="color-swatches">
                ${HERO_COLORS.map((color) => `<button type="button" class="swatch ${color === draft.color ? "active" : ""}" data-color="${color}" style="--swatch:${color}" aria-label="Cor ${color}"></button>`).join("")}
              </div>
            </div>
            <div class="stats-editor">
              <div class="stats-editor-head"><span>ATRIBUTOS</span><b><span data-budget>${statsTotal}</span> / ${STAT_BUDGET}</b></div>
              ${STAT_KEYS.map((key) => `
                <label class="stat-slider" title="${STAT_DESCRIPTIONS[key]}">
                  <span>${STAT_LABELS[key]}</span>
                  <input type="range" min="${STAT_MIN}" max="${STAT_MAX}" step="${STAT_STEP}" value="${draft.stats[key]}" data-stat="${key}">
                  <b data-stat-value="${key}">${draft.stats[key]}</b>
                </label>`).join("")}
              <small class="budget-hint">Limite de ${STAT_BUDGET} pontos (${STAT_MIN} a ${STAT_MAX} por atributo). Passe o mouse em cada atributo para ver o que ele faz.</small>
            </div>
          </div>
          <div class="creator-column creator-side">
            <div class="creator-preview" style="--hero-color:${draft.color}">
              ${heroAvatar({ name: draft.name || "Novo Herói", color: draft.color }, "large preview-avatar")}
              <h2 data-preview-name>${escapeHtml(draft.name || "Novo Herói")}</h2>
              <span class="role-badge" data-preview-role>${ROLE_LABELS[draft.role]}</span>
              <div class="stat-bars compact preview-stats">
                ${STAT_KEYS.map((key) => `<div class="stat-row" title="${STAT_DESCRIPTIONS[key]}"><span>${STAT_LABELS[key]}</span><div class="stat-track"><i data-stat-bar="${key}" style="width:${draft.stats[key]}%"></i></div><b data-stat-text="${key}">${draft.stats[key]}</b></div>`).join("")}
              </div>
            </div>
            <div class="field-label">Barra de especial
              <div class="preset-grid">
                ${BAR_PRESETS.map((preset) => `
                  <button type="button" class="preset-option ${preset.id === draft.barPreset ? "active" : ""}" data-bar-preset="${preset.id}">
                    <b>${preset.label}</b><small>${preset.detail}</small><code>${preset.segments.join(" / ")}</code>
                  </button>`).join("")}
              </div>
            </div>
            <div class="field-label">Habilidades <small>(até 2)</small>
              <div class="ability-options">
                ${Object.values(ABILITIES).map((ability) => `
                  <label class="ability-option">
                    <input type="checkbox" value="${ability.id}" data-ability ${draft.abilities.includes(ability.id) ? "checked" : ""}>
                    <span class="ability-option-body" style="--chip-color:${ABILITY_COLORS[ability.id] ?? "#ffd9a0"}">
                      <b>${escapeHtml(ability.name)}</b>
                      <small>${ability.role === draft.role ? "Recomendada · " : ""}custo ${ability.cost}</small>
                    </span>
                  </label>`).join("")}
              </div>
            </div>
          </div>
        </div>
        <p class="form-error" data-error></p>
        <div class="screen-actions">
          <button type="button" class="btn ghost" data-action="select">Cancelar</button>
          <button type="submit" class="btn primary">${editing ? "Salvar alterações" : "Criar personagem"}</button>
        </div>
      </form>
    </section>`;
}
