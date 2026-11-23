import { ABILITIES, ABILITY_COLORS, getAbilityPowerMult } from "../domain/abilities";
import { listHeroes } from "../domain/heroes";
import { ROLE_CHARGE_SUMMARY, ROLE_IDENTITY_SUMMARY } from "../domain/roles";
import { STAT_BUDGET, STAT_MAX, STAT_MIN, STAT_REFERENCE, STAT_STEP } from "../domain/stats";
import type { AbilityTrigger, HeroDefinition, HeroStats, RodId, Role } from "../domain/types";
import { keyLabel, type ControlScheme } from "../game/input";
import type { AiDifficulty } from "../game/match";
import type { PlayerProfile } from "../net/firebase";

export type ScreenName = "auth" | "menu" | "modes" | "online" | "select" | "creator" | "howto" | "controls" | "game";
export type AuthMode = "login" | "register";

export { STAT_BUDGET, STAT_MIN, STAT_MAX };

export const ROLE_LABELS: Record<Role, string> = {
  ofensivo: "Ofensivo",
  defensivo: "Defensivo",
  coringa: "Coringa",
};

export const ROD_LABELS: Record<RodId, string> = {
  goleiro: "Goleiro (Q)",
  defesa: "Defesa (W)",
  meio: "Meio (E)",
  ataque: "Ataque (R)",
};

const TRIGGER_LABELS: Record<AbilityTrigger, string> = {
  instant: "Imediata",
  next_kick: "Próximo chute",
  next_defense: "Próxima defesa",
  timed: "Ativa por tempo",
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
  { id: "medio", label: "3 segmentos", detail: "carga equilibrada", segments: [30, 30, 40] },
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
  faceImage?: string;
  bodyImage?: string;
}

export const HERO_COLORS = ["#ff9f43", "#6fd7ff", "#c792ff", "#8affc1", "#ff5d8f", "#ffd166"];

export function createHeroDraft(): HeroDraft {
  return {
    name: "",
    role: "coringa",
    color: HERO_COLORS[2]!,
    stats: { kickPower: 30, ballControl: 30, rodSpeed: 30, defense: 30, goalkeeping: 30 },
    barPreset: "tatico",
    abilities: ["leitura_de_jogo", "chute_diagonal"],
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
    faceImage: hero.faceImage,
    bodyImage: hero.bodyImage,
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

export function heroAvatar(hero: { name: string; color?: string; faceImage?: string }, cssClass = ""): string {
  const color = hero.color ?? HERO_COLORS[2]!;
  const face = hero.faceImage
    ? `<img class="avatar-face" src="${escapeHtml(hero.faceImage)}" alt="">`
    : "";
  return `<span class="hero-avatar ${cssClass}" style="--hero-color:${color}">${face}<span>${escapeHtml(initials(hero.name))}</span></span>`;
}

/** Arte de corpo inteiro no criador; placeholder enquanto não há upload. */
function bodyArt(hero: { name: string; color?: string; bodyImage?: string }, cssClass = ""): string {
  const color = hero.color ?? HERO_COLORS[2]!;
  if (hero.bodyImage) {
    return `<img class="hero-body-art ${cssClass}" src="${escapeHtml(hero.bodyImage)}" alt="Corpo de ${escapeHtml(hero.name || "Novo Herói")}">`;
  }
  return `<div class="hero-body-art placeholder ${cssClass}" style="--hero-color:${color}">
    <span>${escapeHtml(initials(hero.name || "Novo Herói"))}</span>
    <small>envie uma imagem do corpo</small>
  </div>`;
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
  return [...hero.abilities]
    .sort((a, b) => (ABILITIES[a]?.cost ?? 0) - (ABILITIES[b]?.cost ?? 0))
    .map((id) => {
      const ability = ABILITIES[id];
      if (!ability) return "";
      return `<button type="button" class="ability-chip" data-ability-info-id="${escapeHtml(id)}" data-ability-count="${hero.abilities.length}" style="--chip-color:${ABILITY_COLORS[id] ?? "#ffd9a0"}">${escapeHtml(ability.name)}</button>`;
    }).join("");
}

/** Painel de detalhes: o que faz, onde usa, custo e bônus por quantidade. */
export function abilityInfoHtml(abilityId: string, abilityCount = 4): string {
  const ability = ABILITIES[abilityId];
  if (!ability) return `<p class="ability-detail-empty">Selecione uma habilidade.</p>`;
  const color = ABILITY_COLORS[ability.id] ?? "#ffd9a0";
  const power = getAbilityPowerMult(abilityCount);
  const bonus = power === 1 ? "padrão" : `+${Math.round((power - 1) * 100)}%`;
  const rods = ability.allowedRods.map((rod) => ROD_LABELS[rod]).join(" · ");
  return `
    <div class="ability-detail-card" style="--chip-color:${color}">
      <div class="ability-detail-head">
        <b>${escapeHtml(ability.name)}</b>
        <span>${ROLE_LABELS[ability.role]}</span>
      </div>
      <p>${escapeHtml(ability.description)}</p>
      <div class="ability-detail-grid">
        <div><small>BARRA</small><b>${rods}</b></div>
        <div><small>GATILHO</small><b>${TRIGGER_LABELS[ability.trigger]}</b></div>
        <div><small>CUSTO</small><b>${ability.cost} energia</b></div>
        <div><small>RECUPERAÇÃO</small><b>${(ability.cooldownMs / 1000).toFixed(0)}s</b></div>
        <div><small>PODER AQUI</small><b>${bonus} (${abilityCount} habs)</b></div>
      </div>
    </div>`;
}

function heroCard(hero: HeroDefinition, selected: boolean): string {
  const segments = hero.specialBar.segments.join(" · ");
  return `
    <article class="hero-card ${selected ? "selected" : ""}" style="--hero-color:${hero.color ?? HERO_COLORS[2]!}">
      <div class="hero-card-head">
        ${heroAvatar(hero)}
        ${hero.bodyImage ? `<img class="hero-body-thumb" src="${escapeHtml(hero.bodyImage)}" alt="">` : ""}
        <div>
          <span class="role-badge" title="${ROLE_IDENTITY_SUMMARY[hero.role]}">${ROLE_LABELS[hero.role]}</span>
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
        <button type="button" class="btn ghost btn-sm" data-edit-hero="${escapeHtml(hero.id)}">Editar</button>
      </div>
    </article>`;
}

function brand(): string {
  return `<div class="brand"><span class="brand-icon">P</span><div><strong>PIMBOCAS</strong><small>PEBOLIM ARENA · 1V1</small></div></div>`;
}

function appHeader(profile: PlayerProfile, active = ""): string {
  const navItems = [
    { action: "home", label: "Início" },
    { action: "play", label: "Jogar" },
    { action: "select", label: "Heróis" },
    { action: "online", label: "Online" },
    { action: "controls", label: "Controles" },
    { action: "howto", label: "Guia" },
  ];
  const nav = navItems.map((item) => `
    <button type="button" class="nav-btn ${item.action === active ? "active" : ""}" data-action="${item.action}">${item.label}</button>
  `).join("");
  return `
    <header class="app-header">
      ${brand()}
      <nav class="app-nav" aria-label="Navegação principal">${nav}</nav>
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
      <div class="auth-card">
        <div class="auth-brand">${brand()}</div>
        <h1>${registering ? "Crie sua conta" : "Bem-vindo de volta"}</h1>
        <p class="auth-subtitle">${registering ? "Escolha seu herói e entre na arena." : "Entre na arena, solte as habilidades e dispute o topo do placar."}</p>
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
      ${appHeader(profile, "home")}
      <div class="menu-content">
        <div class="menu-headline">
          <span class="eyebrow">Mesa 01 · PE BOLIM LIGA</span>
          <h1>SUA MESA.<br><em>SEU HERÓI.</em></h1>
          <p>Escolha seu lutador, configure os controles e entre na arena. Modo online 1v1 com sala própria já disponível.</p>
          <button type="button" class="btn primary btn-hero" data-action="play">Jogar <span>→</span></button>
        </div>
        <div class="menu-side">
          <div class="menu-hero-card" style="--hero-color:${hero.color ?? HERO_COLORS[2]!}">
            <span class="menu-label">PERSONAGEM ATUAL</span>
            ${heroAvatar(hero, "large")}
            <h2>${escapeHtml(hero.name)}</h2>
            <span class="role-badge" title="${ROLE_IDENTITY_SUMMARY[hero.role]}">${ROLE_LABELS[hero.role]}</span>
            <div class="ability-chips">${abilityChips(hero)}</div>
            <button type="button" class="btn ghost btn-sm" data-action="select">Trocar personagem</button>
          </div>
          <div class="menu-links">
            <button type="button" data-action="controls"><b>⌨</b> Controles</button>
            <button type="button" data-action="howto"><b>?</b> Como jogar</button>
          </div>
        </div>
      </div>
      <footer class="menu-footer">Elenco oficial · ${listHeroes().length} heróis · MMR ${profile.mmr}</footer>
    </section>`;
}

export function selectScreen(profile: PlayerProfile): string {
  const heroes = listHeroes();
  return `
    <section class="screen select-screen">
      ${appHeader(profile, "select")}
      <div class="screen-heading">
        <div>
          <span class="eyebrow">SELEÇÃO DE PERSONAGENS</span>
          <h1>Escolha seu herói</h1>
          <p>Cada personagem tem atributos, funções e uma barra de especial diferente.</p>
        </div>
        <span class="eyebrow">${heroes.length} heróis · edite qualquer um</span>
      </div>
      <div class="hero-grid">${heroes.map((hero) => heroCard(hero, hero.id === profile.selectedHeroId)).join("")}</div>
      <section class="ability-detail" data-ability-info>
        <p class="ability-detail-empty">Passe o mouse ou clique no nome de uma habilidade para ver o que ela faz, a barra em que atua e o bônus de poder do herói.</p>
      </section>
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
      ${appHeader(profile, "play")}
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
        <article class="mode-card available">
          <div class="mode-icon">🌐</div>
          <span class="mode-tag">DISPONÍVEL</span>
          <h2>Online 1v1</h2>
          <p>Pareamento por MMR e partida em tempo real com outro jogador.</p>
          <button type="button" class="btn outline" data-action="online">Abrir sala →</button>
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

export function onlineScreen(profile: PlayerProfile, status: string, createdCode?: string | null, inputValue = ""): string {
  return `
    <section class="screen modes-screen">
      ${appHeader(profile, "online")}
      <div class="screen-heading">
        <div>
          <span class="eyebrow">MODO ONLINE · 1V1</span>
          <h1>Sala de pebolim</h1>
          <p>Crie uma sala e envie o código, ou entre na sala do seu amigo.</p>
        </div>
        <button type="button" class="btn ghost" data-action="menu">Voltar</button>
      </div>
      <div class="room-grid">
        <article class="mode-card available">
          <div class="mode-icon">🚪</div>
          <span class="mode-tag">CRIAR</span>
          <h2>Hospedar sala</h2>
          ${createdCode
            ? `<p class="room-code">${escapeHtml(createdCode)}</p><p>Envie este código para o seu amigo.</p>`
            : `<p>Você será o host da partida.</p><button type="button" class="btn primary" data-action="create-room">Criar sala</button>`}
        </article>
        <article class="mode-card ${createdCode ? "locked" : "available"}">
          <div class="mode-icon">🔑</div>
          <span class="mode-tag">ENTRAR</span>
          <h2>Usar código</h2>
          <p>Digite o código recebido, por exemplo PIMBO-K7X9QA.</p>
          <input class="room-input" data-room-code value="${escapeHtml(inputValue)}" placeholder="PIMBO-XXXXXX" maxlength="14" ${createdCode ? "disabled" : ""}>
          <button type="button" class="btn outline" data-action="join-room" ${createdCode ? "disabled" : ""}>Entrar na sala</button>
        </article>
      </div>
      <div class="online-status" data-online-status>
        <div class="mode-icon">🌐</div>
        <p>${escapeHtml(status || "Escolha criar ou entrar em uma sala.")}</p>
      </div>
      <div class="screen-actions">
        <button type="button" class="btn ghost" data-action="cancel-online">Cancelar e voltar</button>
      </div>
      <p class="form-error" data-error></p>
    </section>`;
}

export function controlsScreen(profile: PlayerProfile, scheme: ControlScheme, waitingFor: string | null): string {
  const groups = [
    {
      title: "Selecionar barra",
      items: [
        { id: "goleiro", label: "Goleiro" },
        { id: "defesa", label: "Defesa" },
        { id: "meio", label: "Meio" },
        { id: "ataque", label: "Ataque" },
      ],
    },
    {
      title: "Mover e chutar",
      items: [
        { id: "moveUp", label: "Mover para cima" },
        { id: "moveDown", label: "Mover para baixo" },
        { id: "kickForward", label: "Chutar para frente (segurar/soltar)" },
        { id: "kickBackward", label: "Chutar para trás (segurar/soltar)" },
      ],
    },
    {
      title: "Habilidades",
      items: [1, 2, 3, 4].map((slot) => ({ id: `ability${slot}`, label: `Habilidade ${slot}` })),
    },
  ];

  const rows = groups.map((group) => `
    <h2>${group.title}</h2>
    <div class="key-list">
      ${group.items.map((item) => {
        const current = getBindingSafe(scheme, item.id);
        return `<div>
          <button type="button" class="key-bind ${waitingFor === item.id ? "listening" : ""}" data-rebind="${item.id}">
            ${waitingFor === item.id ? "Pressione uma tecla…" : keyLabel(current)}
          </button>
          <span>${item.label}</span>
        </div>`;
      }).join("")}
    </div>`).join("");

  return `
    <section class="screen howto-screen">
      ${appHeader(profile, "controls")}
      <div class="screen-heading">
        <div>
          <span class="eyebrow">CONFIGURAÇÕES</span>
          <h1>Controles</h1>
          <p>Clique numa tecla e depois pressione a nova. A configuração fica salva neste navegador.</p>
        </div>
        <button type="button" class="btn ghost" data-action="menu">Voltar</button>
      </div>
      <div class="howto-grid">
        <div class="howto-card">${rows}
          <p class="form-error" data-error></p>
        </div>
      </div>
      <div class="screen-actions">
        <button type="button" class="btn outline" data-action="reset-controls">Restaurar padrão</button>
        <button type="button" class="btn primary" data-action="controls-back">Concluir</button>
      </div>
    </section>`;
}

function getBindingSafe(scheme: ControlScheme, id: string): string {
  if (id.startsWith("ability")) {
    const index = Number(id.slice(7)) - 1;
    return scheme.abilitySlots[index] ?? "";
  }
  if (id === "moveUp") return scheme.moveUp;
  if (id === "moveDown") return scheme.moveDown;
  if (id === "kickForward") return scheme.kickForward;
  if (id === "kickBackward") return scheme.kickBackward;
  return scheme.rods.find((binding) => binding.rod === id)?.key ?? "";
}

export function howToScreen(scheme: ControlScheme, profile?: PlayerProfile | null): string {
  const abilityRows = Object.values(ABILITIES).map((ability) => {
    const rods = ability.allowedRods.map((rod) => ROD_LABELS[rod].replace(/\s*\(.+\)/, "")).join("/");
    return `<li>
      <b style="color:${ABILITY_COLORS[ability.id] ?? "#ffd9a0"}">${escapeHtml(ability.name)}</b>
      <small>custo ${ability.cost} · ${rods} · ${TRIGGER_LABELS[ability.trigger]}</small>
      <span>${escapeHtml(ability.description)}</span>
    </li>`;
  }).join("");
  return `
    <section class="screen howto-screen">
      ${profile ? appHeader(profile, "howto") : `<header class="app-header">${brand()}<button type="button" class="btn ghost btn-sm" data-action="home">Voltar</button></header>`}
      <div class="screen-heading"><div><span class="eyebrow">GUIA RÁPIDO</span><h1>Como jogar</h1></div></div>
      <div class="howto-grid">
        <div class="howto-card">
          <h2>Controles</h2>
          <div class="key-list">
            <div>${scheme.rods.map((b) => `<kbd>${escapeHtml(keyLabel(b.key))}</kbd>`).join("")}<span>Selecionar goleiro, defesa, meio e ataque</span></div>
            <div><kbd>${escapeHtml(keyLabel(scheme.moveUp))}</kbd><kbd>${escapeHtml(keyLabel(scheme.moveDown))}</kbd><span>Mover a barra selecionada</span></div>
            <div><kbd>${escapeHtml(keyLabel(scheme.kickForward))}</kbd><span>Segurar e soltar: chute para frente (força pela carga)</span></div>
            <div><kbd>${escapeHtml(keyLabel(scheme.kickBackward))}</kbd><span>Segurar e soltar: chute para trás</span></div>
            <div>${scheme.abilitySlots.map((code) => `<kbd>${escapeHtml(keyLabel(code))}</kbd>`).join("")}<span>Ativar habilidades (veja o nome no termômetro)</span></div>
            <div><kbd>Esc</kbd><span>Abrir o menu do jogo: continuar, reiniciar, trocar personagem ou voltar ao menu</span></div>
          </div>
          <h2>Queda da mesa</h2>
          <p>Mesas de pebolim não são perfeitamente retas: cada lado tem uma leve inclinação para o seu gol. Quanto mais perto da lateral, mais a bola é puxada para a área — vale observar isso na defesa e nos chutes longos.</p>
          <h2>O adversário também tem habilidades</h2>
          <p>A IA tem herói e barra de especial próprios: <b>Fácil</b> joga com Kenji, <b>Médio</b> com Jhonas e <b>Difícil</b> com Gulias. Ela carrega energia com chutes e defesas e ativa as habilidades sozinha — acompanhe a barra no canto superior esquerdo. O gol de goleiro limpo dela também vale <b>2 pontos</b>.</p>
          <h2>Fogo e vitória</h2>
          <ul>
            <li>Sem gol por <b>60s</b>, a arena pega fogo: a bola fica mais rápida e mais quicante. A cada stack o fogo começa antes.</li>
            <li>A partida termina quando alguém abre <b>3 pontos</b> de vantagem.</li>
            <li>Se alguém chegar a <b>10 pontos</b> sem essa margem, o placar zera e o jogo vai para o <b>stack 2</b> (IA mais agressiva e fogo mais rápido). A partida continua.</li>
            <li><b>Chute de Goleiro</b>: gol limpo (sem tocar em nada) vale <b>2 pontos</b>; gol tocado vale 1.</li>
          </ul>
        </div>
        <div class="howto-card howto-wide">
          <h2>Habilidades (${Object.keys(ABILITIES).length} no total)</h2>
          <p><b style="color:#b4691a">Auto-disparo:</b> se a bola estiver perto da barra da habilidade, ela <b>pega a bola e chuta sozinha</b> — não precisa segurar <kbd>${escapeHtml(keyLabel(scheme.kickForward))}</kbd>. Se não estiver, fica armada para o próximo chute.</p>
          <p>Cada habilidade responde ao atributo correspondente: chute, controle, defesa ou goleiro. Personagens com o stat alto deixam a mesma habilidade mais forte.</p>
          <p><b style="color:#ffe7a3">Cópia (Paulo):</b> empresta uma habilidade de outro herói por alguns segundos, aparecendo como slot extra sem custo. <b style="color:#b28cff">Roletada (Jhonas):</b> bomba fortíssima, porém descontrolada, que trava o manete por 1,4 s. <b style="color:#7cffb2">Rebote (Kenji):</b> o boneco fica no aguardo e contra-ataca forte se a bola bater nele. <b style="color:#7ee8fa">Os Gêmeos</b> fazem passes coreografados entre barras e <b style="color:#ff9f43">o Churrasqueiro</b> gira o meio e estoura a bola rumo ao gol.</p>
          <ul class="ability-list">${abilityRows}</ul>
        </div>
        <div class="howto-card">
          <h2>Poder por quantidade</h2>
          <p>Todo personagem tem de <b>2 a 4 habilidades</b>. Quem tem menos, compensa com mais poder em cada uma:</p>
          <ul>
            <li><b>2 habilidades:</b> +${Math.round((getAbilityPowerMult(2) - 1) * 100)}% de poder</li>
            <li><b>3 habilidades:</b> +${Math.round((getAbilityPowerMult(3) - 1) * 100)}% de poder</li>
            <li><b>4 habilidades:</b> poder padrão</li>
          </ul>
          <p>Passe o mouse ou clique no nome de uma habilidade na seleção para ver barra, gatilho, custo, recuperação e bônus.</p>
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
          <p><b>Identidade de role:</b> ofensivo ${ROLE_IDENTITY_SUMMARY.ofensivo} defensivo ${ROLE_IDENTITY_SUMMARY.defensivo} coringa ${ROLE_IDENTITY_SUMMARY.coringa}</p>
          <h2>Imagens do herói</h2>
          <p>No criador você pode enviar uma foto <b>só do rosto</b> (aparece na borda da mesa) e outra de <b>corpo inteiro</b> (aparece nos cartões). Sem upload, o jogo usa placeholders.</p>
        </div>
      </div>
    </section>`;
}

export function creatorScreen(profile: PlayerProfile, draft: HeroDraft): string {
  const editing = !!draft.id;
  const statsTotal = STAT_KEYS.reduce((sum, key) => sum + draft.stats[key], 0);
  return `
    <section class="screen creator-screen">
      ${appHeader(profile, "select")}
      <div class="screen-heading">
        <div>
          <span class="eyebrow">CRIADOR DE PERSONAGEM</span>
          <h1>${editing ? "Editar personagem" : "Crie seu herói"}</h1>
          <p>Distribua os atributos, escolha a barra, envie as imagens e equipe de 2 a 4 habilidades.</p>
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
            <div class="field-label">Imagens do personagem <small>(opcional)</small>
              <div class="image-uploads">
                <label class="image-upload">
                  <input type="file" accept="image/*" data-image="face">
                  <span class="image-upload-preview face" data-image-preview="face">
                    ${draft.faceImage ? `<img src="${escapeHtml(draft.faceImage)}" alt="">` : "<b>+</b><small>Rosto (aparece na mesa)</small>"}
                  </span>
                </label>
                <label class="image-upload">
                  <input type="file" accept="image/*" data-image="body">
                  <span class="image-upload-preview body" data-image-preview="body">
                    ${draft.bodyImage ? `<img src="${escapeHtml(draft.bodyImage)}" alt="">` : "<b>+</b><small>Corpo inteiro</small>"}
                  </span>
                </label>
              </div>
              <small class="budget-hint">Use JPG/PNG até ~5 MB. A imagem é reduzida antes de salvar. Sem imagem, usamos placeholders.</small>
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
              <div data-body-preview>${bodyArt({ ...draft, name: draft.name || "Novo Herói" }, "preview-body")}</div>
              ${heroAvatar({ name: draft.name || "Novo Herói", color: draft.color, faceImage: draft.faceImage }, "large preview-avatar")}
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
            <div class="field-label">Habilidades <small>(<span data-ability-total>${draft.abilities.length}</span>/4 · mínimo 2)</small>
              <div class="ability-options">
                ${Object.values(ABILITIES).map((ability) => `
                  <label class="ability-option">
                    <input type="checkbox" value="${ability.id}" data-ability ${draft.abilities.includes(ability.id) ? "checked" : ""}>
                    <span class="ability-option-body" style="--chip-color:${ABILITY_COLORS[ability.id] ?? "#ffd9a0"}" data-ability-info-id="${escapeHtml(ability.id)}" data-ability-count="${draft.abilities.length}">
                      <b>${escapeHtml(ability.name)}</b>
                      <small>${ability.role === draft.role ? "Recomendada · " : ""}custo ${ability.cost}</small>
                    </span>
                  </label>`).join("")}
              </div>
              <small class="budget-hint">Qualquer personagem pode usar qualquer habilidade — não existe habilidade exclusiva. Quanto menos habilidades, maior o bônus: 2 habs = +25%, 3 habs = +12%, 4 habs = padrão. Passe o mouse ou clique no nome para ver os detalhes.</small>
            </div>
          </div>
        </div>
        <section class="ability-detail" data-ability-info>
          <p class="ability-detail-empty">Passe o mouse ou clique no nome de uma habilidade para ver o que ela faz, a barra em que atua e o bônus de poder.</p>
        </section>
        <p class="form-error" data-error></p>
        <div class="screen-actions">
          <button type="button" class="btn ghost" data-action="select">Cancelar</button>
          <button type="submit" class="btn primary">${editing ? "Salvar alterações" : "Criar personagem"}</button>
        </div>
      </form>
    </section>`;
}
