import type { AbilityDefinition } from "./types";

/** Quanto menos habilidades o herói tem, mais forte cada uma delas. */
export const ABILITY_POWER_BY_COUNT: Record<number, number> = { 2: 1.25, 3: 1.12, 4: 1 };

export function getAbilityPowerMult(abilityCount: number): number {
  return ABILITY_POWER_BY_COUNT[abilityCount] ?? 1;
}

export const ABILITY_COLORS: Record<string, string> = {
  chute_diagonal: "#ffb347",
  bloqueio_pesado: "#6fd7ff",
  leitura_de_jogo: "#c792ff",
  cruzador_estelar: "#ff6bd6",
  chute_fantasma: "#c0ff8a",
  combo_breaker: "#ffe066",
  mao_grande: "#8affc1",
  chute_goleiro: "#ff9f43",
  zaga_magnetica: "#5ee0ff",
  chute_relampago: "#f6ff6b",
  elastico: "#ff8ad8",
  forca_bruta: "#ff5d5d",
  copia: "#ffe7a3",
  roletada: "#b28cff",
  rebote: "#7cffb2",
};

export const ABILITIES: Record<string, AbilityDefinition> = {
  chute_diagonal: {
    id: "chute_diagonal",
    name: "Chute Diagonal",
    hint: "CHUTE +50% · trajetória oblíqua com efeito",
    description:
      "Arma o próximo chute: bola mais rápida e forte, com trajetória diagonal. Melhor usada nas barras de ataque ou meio.",
    role: "ofensivo",
    cost: 25,
    cooldownMs: 8000,
    allowedRods: ["ataque", "meio"],
    trigger: "next_kick",
    activationWindowMs: 1500,
    effect: {
      ballSpeedMult: 1.5,
      kickPowerMult: 1.35,
      tag: "diagonal_shot",
    },
  },
  bloqueio_pesado: {
    id: "bloqueio_pesado",
    name: "Bloqueio Pesado",
    hint: "DEFESA RÍGIDA · bonecos maiores e rebote -70%",
    description:
      "Reforça a defesa por um curto período: reduz rebote e aumenta a eficiência do bloqueio no goleiro ou defesa.",
    role: "defensivo",
    cost: 25,
    cooldownMs: 9000,
    allowedRods: ["goleiro", "defesa"],
    trigger: "next_defense",
    activationWindowMs: 1200,
    effect: {
      reboundMult: 0.3,
      durationMs: 1400,
      tag: "heavy_block",
    },
  },
  leitura_de_jogo: {
    id: "leitura_de_jogo",
    name: "Leitura de Jogo",
    hint: "LEITURA 2s · barra rápida, chute +10%, rebote -25%",
    description:
      "Habilidade versátil: melhora controle e resposta por pouco tempo. Pode ser usada em qualquer barra.",
    role: "coringa",
    cost: 30,
    cooldownMs: 10000,
    allowedRods: ["goleiro", "defesa", "meio", "ataque"],
    trigger: "timed",
    activationWindowMs: 0,
    effect: {
      kickPowerMult: 1.1,
      reboundMult: 0.75,
      durationMs: 2000,
      tag: "read_play",
    },
  },
  cruzador_estelar: {
    id: "cruzador_estelar",
    name: "Cruzador Estelar",
    hint: "CRUZADOR +80% · giro longo e trajetória atravessa a defesa",
    description:
      "Da barra do meio: um chute diagonal violento. A bola continua girando por muito tempo e, mesmo sendo bloqueada, mantém quase todo o rumo original.",
    role: "ofensivo",
    cost: 50,
    cooldownMs: 10000,
    allowedRods: ["meio"],
    trigger: "next_kick",
    activationWindowMs: 1800,
    effect: {
      ballSpeedMult: 1.8,
      kickPowerMult: 1.5,
      trajectoryKeep: 0.9,
      spinRetention: 0.12,
      durationMs: 1500,
      tag: "stellar_cross",
    },
  },
  chute_fantasma: {
    id: "chute_fantasma",
    name: "Chute Fantasma",
    hint: "FANTASMA · a bola finta para o lado oposto e volta na curva",
    description:
      "O chute sai na diagonal contrária por um instante, enganando a defesa, e depois a bola curva violentamente de volta ao rumo verdadeiro.",
    role: "ofensivo",
    cost: 30,
    cooldownMs: 8500,
    allowedRods: ["meio", "ataque"],
    trigger: "next_kick",
    activationWindowMs: 1600,
    effect: {
      ballSpeedMult: 1.25,
      kickPowerMult: 1.2,
      ghostDelayMs: 320,
      ghostStrength: 1.35,
      durationMs: 1100,
      tag: "phantom_shot",
    },
  },
  combo_breaker: {
    id: "combo_breaker",
    name: "Combo Breaker",
    hint: "COMBO BREAKER · 4 rechutes seguidos no mesmo pé",
    description:
      "O jogador pega a bola no pé e dispara uma sequência de chutes rápidos, cada um um pouco mais forte, antes de soltar.",
    role: "ofensivo",
    cost: 20,
    cooldownMs: 9000,
    allowedRods: ["meio", "ataque"],
    trigger: "next_kick",
    activationWindowMs: 1500,
    effect: {
      ballSpeedMult: 1.15,
      kickPowerMult: 1.1,
      comboKicks: 4,
      comboIntervalMs: 130,
      durationMs: 1800,
      tag: "combo_breaker",
    },
  },
  mao_grande: {
    id: "mao_grande",
    name: "Mão Grande",
    hint: "MÃO GRANDE · área do goleiro aumenta por alguns segundos",
    description:
      "O goleiro fica com luvas gigantes: aumenta a área de pegada e o alcance por alguns segundos. Quanto maior o stat de goleiro, maior e mais duradoura a aura.",
    role: "defensivo",
    cost: 30,
    cooldownMs: 9000,
    allowedRods: ["goleiro"],
    trigger: "timed",
    effect: {
      durationMs: 3200,
      goalieAuraRadius: 12,
      tag: "big_hand",
    },
  },
  chute_goleiro: {
    id: "chute_goleiro",
    name: "Chute de Goleiro",
    hint: "GOL DE GOLEIRO · chute fortíssimo, gol limpo vale 2 pontos",
    description:
      "O goleiro sai batendo com força. Se a bola entrar sem tocar em nada — nem parede, nem boneco — o gol vale 2 pontos e ganha um efeito especial.",
    role: "defensivo",
    cost: 50,
    cooldownMs: 11000,
    allowedRods: ["goleiro"],
    trigger: "next_kick",
    activationWindowMs: 1800,
    effect: {
      kickPowerMult: 1.2,
      goalieKickSpeedMult: 1.35,
      durationMs: 1600,
      tag: "goalkeeper_kick",
    },
  },
  zaga_magnetica: {
    id: "zaga_magnetica",
    name: "Zaga Magnética",
    hint: "ZAGA MAGNÉTICA · puxa e desvia a bola sem precisar pegar",
    description:
      "A zaga cria um campo que atrai a bola. Mesmo sem encostar no boneco, a trajetória é desviada um pouco. Escala com o stat de defesa.",
    role: "defensivo",
    cost: 25,
    cooldownMs: 9000,
    allowedRods: ["goleiro", "defesa"],
    trigger: "timed",
    effect: {
      durationMs: 2600,
      magnetRadius: 140,
      magnetStrength: 520,
      tag: "magnetic_defense",
    },
  },
  chute_relampago: {
    id: "chute_relampago",
    name: "Chute Relâmpago",
    hint: "RELÂMPAGO · bate na quina e volta mirando o gol",
    description:
      "Do meio-campo: a bola é enviada para a quina da parede e, ao refletir, já sai em direção à área do gol. A força do chute escala com o stat de chute.",
    role: "ofensivo",
    cost: 25,
    cooldownMs: 8500,
    allowedRods: ["meio"],
    trigger: "next_kick",
    activationWindowMs: 1600,
    effect: {
      ballSpeedMult: 1.2,
      lightningSpeedMult: 1.2,
      durationMs: 1500,
      tag: "lightning_shot",
    },
  },
  elastico: {
    id: "elastico",
    name: "Elástico",
    hint: "ELÁSTICO · rodeia o boneco e ataca entre 1s e 5s",
    description:
      "No ataque, a bola fica girando em volta do boneco por um tempo aleatório entre 1 e 5 segundos e depois sai de uma posição um pouco diferente. Quanto maior o controle, mais tempo ela aguenta rodando.",
    role: "ofensivo",
    cost: 40,
    cooldownMs: 11000,
    allowedRods: ["ataque"],
    trigger: "next_kick",
    activationWindowMs: 1600,
    effect: {
      ballSpeedMult: 1.15,
      elasticMinMs: 1000,
      elasticMaxMs: 5000,
      durationMs: 6200,
      tag: "elastico",
    },
  },
  forca_bruta: {
    id: "forca_bruta",
    name: "Força Bruta",
    hint: "FORÇA BRUTA · bola descontrolada, forte e quicando em tudo",
    description:
      "Do meio-campo: uma bomba sem direção definida, com muito giro e quicadas elásticas nas paredes. Quanto maior o chute, mais violenta a bola.",
    role: "ofensivo",
    cost: 50,
    cooldownMs: 10000,
    allowedRods: ["meio"],
    trigger: "next_kick",
    activationWindowMs: 1600,
    effect: {
      ballSpeedMult: 1.45,
      bruteSpeedMult: 1.5,
      bruteBounce: 0.95,
      durationMs: 1800,
      tag: "brute_force",
    },
  },
  copia: {
    id: "copia",
    name: "Cópia",
    hint: "CÓPIA · rouba a habilidade de outro herói por alguns segundos",
    description:
      "Paulo observa a mesa e empresta uma habilidade de outro personagem por alguns segundos. A habilidade copiada aparece como um slot extra e não gasta energia. A escolha favorece quem está perto da bola: defesa perto do gol, chute perto do ataque.",
    role: "coringa",
    cost: 30,
    cooldownMs: 12000,
    allowedRods: ["goleiro", "defesa", "meio", "ataque"],
    trigger: "timed",
    effect: {
      durationMs: 9000,
      tag: "copy",
    },
  },
  roletada: {
    id: "roletada",
    name: "Roletada",
    hint: "ROLETADA · bomba sem controle, manete travado por 1,4 s",
    description:
      "Jhonas gira o braço e dispara uma bomba muito mais forte, mas sem nenhum controle: a bola sai com giro e direção imprevisíveis. O esforço trava o manete por um instante, impedindo mover a barra.",
    role: "defensivo",
    cost: 40,
    cooldownMs: 12000,
    allowedRods: ["goleiro", "defesa", "meio", "ataque"],
    trigger: "next_kick",
    activationWindowMs: 1600,
    effect: {
      ballSpeedMult: 1.2,
      kickPowerMult: 1.25,
      roletadaSpeedMult: 1.35,
      lockMovementMs: 1400,
      durationMs: 1800,
      tag: "roletada",
    },
  },
  rebote: {
    id: "rebote",
    name: "Rebote",
    hint: "REBOTE · boneco no aguardo e contra-ataque forte",
    description:
      "Kenji fica alguns segundos pronto no boneco. Se a bola bater nele nessa janela, ele devolve um chute forte de atacante na hora. Só funciona uma vez por ativação.",
    role: "ofensivo",
    cost: 30,
    cooldownMs: 10000,
    allowedRods: ["goleiro", "defesa"],
    trigger: "timed",
    effect: {
      durationMs: 3200,
      rebotePower: 1.25,
      tag: "rebote",
    },
  },
};

export function getAbility(id: string): AbilityDefinition {
  const ability = ABILITIES[id];
  if (!ability) throw new Error(`Ability not found: ${id}`);
  return ability;
}
