# Pimbocas — Pibolim Heroes

Base de projeto para um jogo de **pebolim/foosball em tempo real** com heróis, roles e habilidades especiais.

## Ideia central

- Partida 1v1 de pebolim online.
- Cada jogador escolhe um **herói** com stats, role e habilidades.
- Habilidades consomem uma **barra de especial** dividida em **segmentos variáveis**.
- A barra enche passivamente e também por ações de jogo, com bônus conforme a role.

## Stack sugerida

| Camada | Tecnologia | Papel |
|---|---|---|
| Frontend | Vite + TypeScript + Canvas | Cliente do jogo, render, input |
| Meta/game services | Firebase Auth + Firestore | Login, perfil, heróis, matchmaking, progresso |
| Gameplay realtime | PeerJS/WebRTC **ou** WebSocket | Transporte da partida; escolher **um** |
| Autoridade | Host (MVP) ou servidor dedicado | Simulação/validação do estado da partida |

> Firebase não deve ser usado para sincronizar o estado da partida em alta frequência (bola/barras a 30–60 ticks/s).

## Estrutura

```text
src/
  domain/
    types.ts          # Tipos centrais: roles, barras, habilidades, heróis
    roles.ts          # Regras de ganho de carga por role
    abilities.ts      # Catálogo de habilidades
    heroes.ts         # Catálogo base + registro de heróis criados
  game/
    ability-system.ts # Barra de especial, segmentos variáveis, carga, ativação
    match.ts          # Estado da partida, física, IA e habilidades
    input.ts          # Teclado (desativado enquanto menus estão abertos)
  net/
    firebase.ts       # Auth, perfil, loadout, heróis criados e matchmaking MVP
  ui/
    screens.ts        # HTML das telas (login, menu, modos, seleção, editor)
    flow.ts           # Navegação e ações das telas
    field.ts          # Render canvas da mesa
    hud.ts            # Render da HUD/termômetro de especial
  main.ts             # Bootstrap: cria partida quando o fluxo pede
```

## Telas e fluxo

1. **Login / cadastro**: e-mail e senha, Google, convidado (anonymous) ou "Jogar sem conta" (modo local, salvo no `localStorage`).
2. **Menu**: mostra o personagem atual, acesso a modos, seleção, criador e guia.
3. **Modo de jogo**: por enquanto só **Contra a IA** está disponível; Online 1v1 e Torneio aparecem como "em breve". A dificuldade da IA altera velocidade de perseguição, chance de chute, herói e freqüência com que ela usa habilidades: **Fácil** → Léo Coringa, **Médio** → Rafa Artilheiro, **Difícil** → Duda Muralha.
4. **Seleção de personagens**: cartões com atributos, role, habilidades e formato da barra; personagens criados podem ser editados ou excluídos.
5. **Criador de personagem**: nome, cor, role, atributos com orçamento de **200 pontos** (mín. 10 / máx. 100 cada, passos de 5), formato da barra, **de 2 a 4 habilidades** e uploads opcionais de **rosto** (aparece na borda da mesa) e **corpo inteiro** (aparece nos cartões). Imagens são reduzidas no navegador para data URL antes de salvar. O herói é salvo em `users/{uid}.customHeroes` e fica disponível na partida. Heróis salvos com o orçamento antigo são rebalanceados automaticamente ao entrar.
6. **Visual**: login e menus usam um tema claro de boteco (azulejos, balcão de madeira, garrafas verdes/amarelas, luminárias e uma mesa de pebolim em CSS). Na seleção, passe o mouse ou clique no nome de uma habilidade para ver descrição, barra, gatilho, custo, recuperação e bônus de poder.
7. **Partida**: o campo ocupa a tela. O botão "☰ Menu" (ou `Esc`) abre o menu da partida, com **Continuar**, **Reiniciar partida**, **Trocar personagem** e **Voltar ao menu**. A simulação fica pausada enquanto o menu está aberto.

A seleção e os heróis criados são persistidos no perfil do Firebase (ou no modo local, quando sem conta).

## Mecânica da barra de especial

- A barra tem `max` e `current`.
- Os **segmentos são variáveis**: cada configuração define um array de tamanhos, ex. `[25, 25, 25, 25]`, `[20, 30, 50]`, `[40, 60]`.
- Uma habilidade tem custo em pontos (`cost`). Ela pode ser usada quando `current >= cost`.
- A barra enche:
  - **Passivamente**: todo tick/segundo.
  - **Por ação**: o ganho depende da role:
    - **Ofensivo**: chutando, proporcional à **força efetiva do chute** (stat + habilidades). Chute fraquinho rende pouco; chute de 100 rende muito.
    - **Defensivo**: defendendo, proporcional ao **impacto da bola** (save > interceptação > bloqueio).
    - **Coringa**: recebe **30%** do ganho ofensivo e **30%** do defensivo.
  - Gols e passes úteis dão um bônus fixo menor.
- Cooldown é por habilidade, independente da barra.

## Poder por quantidade de habilidades

Todo herói tem de **2 a 4 habilidades**. Quem tem menos, compensa com mais poder em cada uma (`ABILITY_POWER_BY_COUNT`):

| Habilidades | Bônus por habilidade |
|---|---|
| 2 | **+25%** |
| 3 | **+12%** |
| 4 | padrão |

O multiplicador escala velocidade/força da bola, rebote, velocidade da barra, drenagem de defesa, alcance, pegada, tempo de ghost/elástico, magnetismo, força bruta etc. A tela de seleção mostra o bônus no painel de detalhes de cada habilidade.

## Fogo, vitória e stack

- Sem gol por **60 segundos**, a arena pega fogo e a bola flamejante fica mais rápida e mais quicante (`ball.heat`).
- O limite de tempo para esquentar cai a cada stack: `max(20s, 60s / stack)`.
- A partida termina quando um lado abre **3 pontos** de vantagem.
- Se alguém chegar a **10 pontos** sem essa margem, o placar zera e começa o **stack 2** (e assim por diante): a IA fica mais agressiva e o fogo começa mais cedo. A partida **continua**.
- Gol limpo do **Chute de Goleiro** (bola sem tocar em parede ou boneco) vale **2 pontos**; os demais valem 1.

## Queda da mesa

Mesas de pebolim reais têm uma leve inclinação para o gol. Aqui cada metade do campo puxa a bola suavemente para a sua lateral (`FIELD_SLOPE_ACCEL = 34 px/s²` no fim da mesa, zero no centro). O efeito é discreto em chutes rápidos, mas aparece em bolas paradas no meio-campo e ajuda a explicar por que a bola "escorre" para a área. O campo mostra o declínio com um leve escurecimento nas pontas e setas apontando para os gols.

## Atributos (orçamento de 200)

A referência de equilíbrio é **40** por atributo (média de 200 / 5). Acima disso há bônus; abaixo, perda.

| Atributo | O que faz no jogo |
|---|---|
| **Chute** (`kickPower`) | Força do chute. A escala foi aumentada: `100` chega perto de 1,8× a força base e o teto antigo de 1.6 foi removido, então chute forte sai muito mais rápido. |
| **Controle** (`ballControl`) | Quão fácil o boneco trava a bola com ele: reduz o rebote e aumenta o alcance do pé. |
| **Velocidade** (`rodSpeed`) | Quão rápido a barra selecionada se move com `↑`/`↓`. |
| **Defesa** (`defense`) | Drena a velocidade da bola quando ela bate em você, além de aumentar a área de contato da barra de defesa. |
| **Goleiro** (`goalkeeping`) | Alcance e pegada extras **só na barra do goleiro**: mais cobertura lateral/vertical e menos devolução (a bola "cola" mais na defesa). |

Todos os heróis base somam exatamente 200 pontos.

## Heróis e habilidades

| Herói | Role | Barra | Habilidades | Bônus |
|---|---|---|---|---|
| Rafa Artilheiro | Ofensivo | 25 / 25 / 25 / 25 | Chute Diagonal, Chute Relâmpago, Força Bruta | +12% |
| Duda Muralha | Defensivo | 50 / 50 | Bloqueio Pesado, Mão Grande, Zaga Magnética, Chute de Goleiro | padrão |
| Léo Coringa | Coringa | 20 / 30 / 50 | Leitura de Jogo, Chute Diagonal | +25% |
| **Allan** | Ofensivo | 20 / 30 / 50 | Cruzador Estelar, Chute Fantasma, Combo Breaker, Elástico | padrão |
| **Paulo** | Coringa | 30 / 30 / 40 | Chute Relâmpago, **Cópia** | +25% |
| **Jhonas a Sombra** | Defensivo | 50 / 50 | Chute de Goleiro, **Roletada** | +25% |
| **Kenji** | Defensivo | 30 / 30 / 40 | Bloqueio Pesado, **Rebote** | +25% |

**Allan** é o canhoneiro da mesa: `kickPower 100`, `ballControl 40`, `rodSpeed 35`, `defense 15`, `goalkeeping 10` (total 200), cor `#ff6bd6`. Ele troca quase tudo pelo chute mais forte do jogo.

**Paulo** é o coringa versátil: `60 / 55 / 45 / 20 / 20` (total 200). A **Cópia** empresta uma habilidade de outro personagem por 9 s e a coloca como slot extra, sem custo de energia. A escolha prefere habilidades defensivas quando a bola está perto do próprio gol e ofensivas quando ela está no ataque.

**Jhonas a Sombra** tem chute e goleiro altos: `kickPower 80`, `ballControl 15`, `rodSpeed 20`, `defense 30`, `goalkeeping 55` (total 200). A **Roletada** é uma bomba sem controle: sai muito mais rápido, com giro e direção imprevisíveis, e trava o manete por 1,4 s.

**Kenji** é o defensor de alma atacante: `55 / 25 / 30 / 60 / 30` (total 200). Com o **Rebote**, os bonecos de goleiro/defesa ficam brilhando por 3,2 s; se a bola bater nele nessa janela, ele devolve um chute forte na hora (uma vez por ativação).

### As 15 habilidades

Todas respondem ao atributo correspondente — personagens com o stat alto deixam a habilidade mais forte.

| Habilidade | Custo | Barra | Efeito |
|---|---|---|---|
| Chute Diagonal | 25 | meio/ataque | Chute +50%, trajetória oblíqua com efeito |
| Bloqueio Pesado | 25 | goleiro/defesa | Rebote -70% e bloqueio rígido por ~1,4 s |
| Leitura de Jogo | 30 | qualquer | 2 s de barra rápida, chute +10%, rebote -25% |
| Cruzador Estelar | 50 | meio | +80% de velocidade, giro longo, mantém 90% da trajetória após bloqueio |
| Chute Fantasma | 30 | meio/ataque | Finta na diagonal oposta por ~320 ms e curva de volta |
| Combo Breaker | 20 | meio/ataque | 4 rechutes seguidos a cada 130 ms, força crescente |
| Mão Grande | 30 | goleiro | Aura de pegada maior; escala com `goalkeeping` |
| Chute de Goleiro | 50 | goleiro | Bomba do goleiro; gol limpo vale 2 pontos |
| Zaga Magnética | 25 | goleiro/defesa | Campo que atrai/desvia a bola; escala com `defense` |
| Chute Relâmpago | 25 | meio | Bate na quina e volta mirando o gol; escala com `kickPower` |
| Elástico | 40 | ataque | Bola orbita o boneco entre 1 s e 5 s antes de sair; escala com `ballControl` |
| Força Bruta | 50 | meio | Bola descontrolada, muito giro e quicadas elásticas; escala com `kickPower` |
| Cópia | 30 | qualquer | Empresta uma habilidade de outro herói por 9 s como slot extra (sem custo); a escolha preza a região da bola |
| Roletada | 40 | qualquer | Chute muito mais forte e sem controle; trava o manete por ~1,4 s |
| Rebote | 30 | goleiro/defesa | Boneco no aguardo por 3,2 s; se a bola bater nele, contra-ataca forte (1 vez por ativação) |

### Auto-disparo (facilitar o uso)

Ao ativar com `1-4`, a habilidade verifica se a bola está perto de uma barra válida (alcance generoso de ~110 px horizontal / 78 px vertical). Se estiver, **ela pega a bola e executa o chute ou a defesa na hora**, com força máxima — você nem precisa segurar `→`/`←`. Se a bola estiver longe, a habilidade fica armada e disparada no próximo chute manual, como antes.

Isso vale para todas as habilidades de chute/defesa, inclusive Chute Diagonal e Bloqueio Pesado. O nome de cada habilidade aparece no termômetro na altura do seu custo.

### IA também joga com habilidades

O adversário tem herói, barra de especial, carga por chutes/defesas e **usa as próprias habilidades sozinho**. A barra dele aparece no canto superior esquerdo com o nome do herói e os slots (acesos quando há energia, verdes quando estão ativos). Os avisos na tela vêm com o prefixo `IA ·`.

- A cada dificuldade corresponde um herói e uma taxa de ativação: Fácil (Léo Coringa, 0,12/s), Médio (Rafa Artilheiro, 0,25/s) e Difícil (Duda Muralha, 0,4/s).
- Perto do próprio gol a IA prefere habilidades defensivas (Mão Grande, Zaga Magnética, Bloqueio Pesado, Chute de Goleiro); longe dele, prefere as ofensivas (Chute Diagonal, Relâmpago, Força Bruta, Cruzador, Fantasma). Se o herói só tiver um dos tipos, ele usa o que tiver.
- A IA ganha energia com seus chutes e defesas e gasta a mesma energia que você para ativar cada habilidade. Ela também sofre os efeitos: Zaga Magnética atrai a bola, Mão Grande amplia a pegada e o Chute Relâmpago dela mira a quina **esquerda** e rebate para o gol.
- O gol limpo do Chute de Goleiro vale **2 pontos para a IA** também.
- Ficam de fora do conjunto da IA apenas as habilidades que dependem de estado global do jogador local: Cópia, Roletada, Rebote, Combo Breaker e Elástico.

## Controles (base)

| Ação | Tecla padrão | Observação |
|---|---|---|
| Selecionar goleiro | `Q` | Seleciona a barra |
| Selecionar defesa | `W` | Seleciona a barra |
| Selecionar meio | `E` | Seleciona a barra |
| Selecionar ataque | `R` | Seleciona a barra |
| Mover barra | `↑` / `↓` | Move a barra selecionada |
| Chutar para frente | Segurar e soltar `→` | Tempo segurado define a força |
| Chutar para trás | Segurar e soltar `←` | Tempo segurado define a força |
| Habilidade 1-4 | `1`, `2`, `3`, `4` | Ativa o slot de habilidade do herói |
| Abrir menu do jogo | `Esc` ou botão "☰ Menu" | Pausa, reinicia, troca de personagem ou volta ao menu |

> A base atual implementa essa lógica no cliente (`src/game/input.ts`) como protótipo; falta conectar ao gameplay real de física/rede.

## Firebase (sem Cloud Functions)

Você já criou Auth e Firestore no console. O que falta fazer/configurar:

1. **Copiar config do app Web** para `.env` (use `.env.example` como base).
2. **Publicar regras**: copie o conteúdo de `firestore.rules` para Firestore Rules no console (ou use Firebase CLI se tiver).
3. **Ativar provedores de Auth** no Console (Authentication → Sign-in method):
   - **E-mail/senha** para login e cadastro;
   - **Google** para o botão "Continuar com Google";
   - **Anônimo** para "Entrar como convidado" (e para o antigo login rápido `VITE_FIREBASE_AUTH_PROVIDER`).
   Se nenhum estiver ativado, use "Jogar sem conta", que funciona sem Firebase.
4. **Criar coleções conforme uso**: `users`, `loadouts`, `matchmakingQueue`, `matches` são criadas automaticamente pelos primeiros writes; `heroes` é opcional (catálogo pode ficar no cliente).
5. **Índices**: se a query de matchmaking pedir índice, o console do Firestore mostra o link para criar.

Arquivos relevantes:
- `.env.example` — variáveis necessárias.
- `firestore.rules` — regras iniciais (MVP, sem Cloud Functions).
- `src/net/firebase.ts` — cliente Firebase, perfil, loadout e matchmaking simples por transação.

> Sem Cloud Functions, o pareamento no cliente é apenas MVP. Para produção, valide matchmaking/MMR/recompensas em backend confiável.

## Rodando localmente

```bash
npm install
npm run dev
```

## Estado atual da base

- [x] Barra de especial com **segmentos variáveis** por herói.
- [x] Carga por tempo + bônus por role/evento.
- [x] Habilidades com custo, cooldown, armação/ativação.
- [x] Controles base: `Q/W/E/R` selecionar barra, segurar/soltar para chutar com força, `↑/↓` mover, `1-4` habilidades.
- [x] Bola no campo com movimento, colisão nas paredes, gols e placar.
- [x] Base Firebase client + rules + matchmaking simples sem Cloud Functions.
- [x] Telas de login/cadastro, menu, modos, seleção e criador de personagens.
- [x] Personagens criados salvos no perfil e usados na partida (stats influenciam o jogo).
- [x] IA com três níveis de dificuldade, herói próprio, barra de especial e uso automático de habilidades.
- [x] Física de bola/pé e feedback visual das habilidades.
- [x] Atributos com significado próprio e orçamento de 200 pontos (heróis base e criados).
- [x] Chutes fortes escalam de verdade; carga por role (ofensivo/defensivo/coringa 30%).
- [x] 12 habilidades que escalam com os stats; poder extra para heróis com 2 ou 3 habilidades.
- [x] Painel de detalhes das habilidades (barra, gatilho, custo, cooldown e bônus).
- [x] Upload de rosto e corpo inteiro no criador (placeholders quando não há imagem).
- [x] Menu dentro da partida: pausa, reiniciar, trocar personagem e voltar ao menu.
- [x] Heróis Paulo (Cópia), Jhonas a Sombra (Roletada) e Kenji (Rebote).
- [x] Queda natural da mesa puxando a bola para o gol em cada metade do campo.
- [x] Tema claro de boteco no login e menus; campo limpo, sem títulos/painéis no jogo.
- [x] Fogo na arena após 60 s sem gol, vitória por 3 pontos e stack ao chegar a 10.
- [ ] Transporte realtime da partida (PeerJS/WebSocket) e modo Online 1v1.
- [ ] Autoridade/anti-cheat da partida.
- [ ] UI de lobby/matchmaking integrada ao Firebase.
