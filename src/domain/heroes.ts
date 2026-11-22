import { normalizeHeroStats } from "./stats";
import type { HeroDefinition } from "./types";

/** Todos os heróis base somam exatamente 200 pontos de atributo. */
export const HEROES: Record<string, HeroDefinition> = {
  artilheiro: {
    id: "artilheiro",
    name: "Rafa Artilheiro",
    role: "ofensivo",
    description: "Finalizador puro: chute muito acima da média, com Relâmpago e Força Bruta. Fraco na marcação.",
    stats: {
      kickPower: 85,
      ballControl: 45,
      rodSpeed: 45,
      defense: 15,
      goalkeeping: 10,
    },
    // Segmentos variáveis: 4 segmentos iguais
    specialBar: { segments: [25, 25, 25, 25] },
    abilities: ["chute_diagonal", "chute_relampago", "forca_bruta"],
  },
  muralha: {
    id: "muralha",
    name: "Duda Muralha",
    role: "defensivo",
    description: "Muro da mesa: Mão Grande, Zaga Magnética e o Chute de Goleiro que vale 2 pontos se for limpo.",
    stats: {
      kickPower: 25,
      ballControl: 50,
      rodSpeed: 35,
      defense: 70,
      goalkeeping: 20,
    },
    // Segmentos variáveis: 2 segmentos grandes
    specialBar: { segments: [50, 50] },
    abilities: ["bloqueio_pesado", "mao_grande", "zaga_magnetica", "chute_goleiro"],
  },
  coringa: {
    id: "coringa",
    name: "Léo Coringa",
    role: "coringa",
    description: "Equilibrado: recebe 30% do ganho de energia ofensivo e defensivo. Barra tática irregular.",
    stats: {
      kickPower: 45,
      ballControl: 45,
      rodSpeed: 45,
      defense: 35,
      goalkeeping: 30,
    },
    // Segmentos variáveis: tamanhos diferentes
    specialBar: { segments: [20, 30, 50] },
    abilities: ["leitura_de_jogo", "chute_diagonal"],
  },
  allan: {
    id: "allan",
    name: "Allan",
    role: "ofensivo",
    description:
      "Canhoneiro da mesa. Chute no limite de 100 e quatro formas de enganar a defesa: cruzador, fantasma, combo e o elástico que rodeia o boneco antes de atacar.",
    stats: {
      kickPower: 100,
      ballControl: 40,
      rodSpeed: 35,
      defense: 15,
      goalkeeping: 10,
    },
    // 20 / 30 / 50: combo, fantasma e cruzador; elástico completa o set.
    specialBar: { segments: [20, 30, 50] },
    abilities: ["cruzador_estelar", "chute_fantasma", "combo_breaker", "elastico"],
    color: "#ff6bd6",
  },
};

/** Heróis criados pelo jogador, registrados em memória após o login. */
const customHeroes = new Map<string, HeroDefinition>();

export function registerCustomHero(hero: HeroDefinition): HeroDefinition {
  const normalized: HeroDefinition = {
    ...hero,
    stats: normalizeHeroStats(hero.stats),
    custom: true,
  };
  customHeroes.set(hero.id, normalized);
  return normalized;
}

export function unregisterCustomHero(id: string): void {
  customHeroes.delete(id);
}

export function getHero(id: string): HeroDefinition {
  const hero = HEROES[id] ?? customHeroes.get(id);
  if (!hero) throw new Error(`Hero not found: ${id}`);
  return hero;
}

/** Catálogo completo: heróis base + criados, para a tela de seleção. */
export function listHeroes(): HeroDefinition[] {
  return [...Object.values(HEROES), ...customHeroes.values()];
}
