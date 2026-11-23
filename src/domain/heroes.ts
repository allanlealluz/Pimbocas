import { normalizeHeroStats } from "./stats";
import type { HeroDefinition } from "./types";

/** Elenco oficial: sete heróis, todos com 200 pontos de atributo. */
export const HEROES: Record<string, HeroDefinition> = {
  allan: {
    id: "allan",
    name: "Allan",
    role: "ofensivo",
    description:
      "Canhoneiro da mesa. Chute no limite de 100 e três formas de enganar a defesa: cruzador, fantasma e combo. Com três habilidades, cada uma ganha +12% de poder.",
    stats: {
      kickPower: 100,
      ballControl: 40,
      rodSpeed: 35,
      defense: 15,
      goalkeeping: 10,
    },
    // 20 / 30 / 50: combo, fantasma e cruzador — o elástico não faz parte do kit.
    specialBar: { segments: [20, 30, 50] },
    abilities: ["combo_breaker", "chute_fantasma", "cruzador_estelar"],
    color: "#ff6bd6",
  },
  paulo: {
    id: "paulo",
    name: "Paulo",
    role: "coringa",
    description:
      "O ladrão de jogadas: tem o Chute Relâmpago e a Cópia, que rouba por alguns segundos a habilidade de um herói ali na mesa — e você decide quando disparar o slot copiado.",
    stats: {
      kickPower: 60,
      ballControl: 55,
      rodSpeed: 45,
      defense: 20,
      goalkeeping: 20,
    },
    specialBar: { segments: [30, 30, 40] },
    abilities: ["chute_relampago", "copia"],
    color: "#ffe7a3",
  },
  jhonas: {
    id: "jhonas",
    name: "Jhonas a Sombra",
    role: "ofensivo",
    description:
      "Atacante de potência bruta. Destrói a mesa com a Roletada — uma bomba sem controle que trava o manete — e sabe castigar com o Chute de Goleiro quando a bola aparece.",
    stats: {
      kickPower: 80,
      ballControl: 25,
      rodSpeed: 30,
      defense: 20,
      goalkeeping: 45,
    },
    specialBar: { segments: [50, 50] },
    abilities: ["chute_goleiro", "roletada"],
    color: "#b28cff",
  },
  kenji: {
    id: "kenji",
    name: "Kenji",
    role: "coringa",
    description:
      "Coringa tático: lê o jogo, troca o ritmo com o Chute Diagonal, contra-ataca com o Rebote e ainda trav o caminho com o Bloqueio Pesado.",
    stats: {
      kickPower: 45,
      ballControl: 40,
      rodSpeed: 40,
      defense: 45,
      goalkeeping: 30,
    },
    specialBar: { segments: [20, 30, 50] },
    abilities: ["leitura_de_jogo", "chute_diagonal", "bloqueio_pesado", "rebote"],
    color: "#7cffb2",
  },
  gulias: {
    id: "gulias",
    name: "Gulias",
    role: "defensivo",
    description:
      "O muro da mesa: defesa e controle altíssimos, mas bem lento. Segura tudo com Mão Grande, Força Bruta e o Chute de Goleiro que vale 2 pontos se for limpo.",
    stats: {
      kickPower: 45,
      ballControl: 55,
      rodSpeed: 10,
      defense: 80,
      goalkeeping: 10,
    },
    specialBar: { segments: [50, 50] },
    abilities: ["forca_bruta", "chute_goleiro", "mao_grande"],
    color: "#6fd7ff",
  },
  geminios: {
    id: "geminios",
    name: "Os Gêmeos",
    role: "defensivo",
    description:
      "Defesa equilibrada e passes milimétricos: o Chute Duplo leva do meio ao ataque, a Sequência de Toques alinha o zagueiro ao meio e o Rebote castiga quem encosta na zaga.",
    stats: {
      kickPower: 40,
      ballControl: 50,
      rodSpeed: 45,
      defense: 45,
      goalkeeping: 20,
    },
    specialBar: { segments: [30, 30, 40] },
    abilities: ["chute_duplo", "rebote", "sequencia_toques"],
    color: "#7ee8fa",
  },
  churrasqueiro: {
    id: "churrasqueiro",
    name: "Churrasqueiro",
    role: "coringa",
    description:
      "Coringa da grelha: gira o meio-campo para devolver a bola em qualquer direção e usa a Explosão para comprimir, pular e mandar a bola rodando ao gol. Duas habilidades com +25% de poder.",
    stats: {
      kickPower: 55,
      ballControl: 45,
      rodSpeed: 50,
      defense: 30,
      goalkeeping: 20,
    },
    specialBar: { segments: [50, 50] },
    abilities: ["rotacionar", "explosao"],
    color: "#ff9f43",
  },
};

/** Heróis criados pelo jogador, registrados em memória após o login. */
const customHeroes = new Map<string, HeroDefinition>();

export function registerCustomHero(hero: HeroDefinition): HeroDefinition {
  const normalized: HeroDefinition = {
    ...hero,
    stats: normalizeHeroStats(hero.stats),
    // Edições dos heróis base vêm do banco com custom:false e não devem
    // aparecer com o selo "CRIADO".
    custom: hero.custom ?? true,
  };
  customHeroes.set(hero.id, normalized);
  return normalized;
}

export function unregisterCustomHero(id: string): void {
  customHeroes.delete(id);
}

/**
 * Overrides salvos no banco (inclusive edições dos heróis base) têm prioridade.
 * Assim editar o Paulo no editor muda o herói usado em qualquer tela/partida.
 */
export function getHero(id: string): HeroDefinition {
  const hero = customHeroes.get(id) ?? HEROES[id];
  if (!hero) throw new Error(`Hero not found: ${id}`);
  return hero;
}

/** Catálogo completo: heróis base + criados/editados, para a tela de seleção. */
export function listHeroes(): HeroDefinition[] {
  const baseIds = new Set(Object.keys(HEROES));
  const overrides = [...customHeroes.entries()]
    .filter(([id]) => !baseIds.has(id))
    .map(([, hero]) => hero);
  return [...Object.values(HEROES).map((hero) => getHero(hero.id)), ...overrides];
}
