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
3. **Modo de jogo**: por enquanto só **Contra a IA** está disponível; Online 1v1 e Torneio aparecem como "em breve". A dificuldade da IA altera velocidade de perseguição e chance de chute.
4. **Seleção de personagens**: cartões com atributos, role, habilidades e formato da barra; personagens criados podem ser editados ou excluídos.
5. **Criador de personagem**: nome, cor, role, atributos com orçamento de **200 pontos** (mín. 10 / máx. 100 cada, passos de 5), formato da barra e até 2 habilidades. O herói é salvo em `users/{uid}.customHeroes` e fica disponível na partida. Heróis salvos com o orçamento antigo são rebalanceados automaticamente ao entrar.
6. **Partida**: o campo ocupa a tela; `Esc` ou o botão "← Menu" encerra e volta ao menu.

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

| Herói | Role | Barra | Habilidades |
|---|---|---|---|
| Rafa Artilheiro | Ofensivo | 25 / 25 / 25 / 25 | Chute Diagonal |
| Duda Muralha | Defensivo | 50 / 50 | Bloqueio Pesado |
| Léo Coringa | Coringa | 20 / 30 / 50 | Leitura de Jogo, Chute Diagonal |
| **Allan** | Ofensivo | 20 / 30 / 50 | Cruzador Estelar, Chute Fantasma, Combo Breaker |

**Allan** é o canhoneiro da mesa: `kickPower 100`, `ballControl 40`, `rodSpeed 35`, `defense 15`, `goalkeeping 10` (total 200), cor `#ff6bd6`. Ele troca quase tudo pelo chute mais forte do jogo.

- **Cruzador Estelar** (`1`, custo 50, só na barra do meio): chute diagonal violentíssimo (+80% de velocidade). A bola guarda o rumo por 1,5 s e gira com decay lento; mesmo batendo na defesa, mantém **90%** da trajetória original e ganha um efeito "CRUZADOR".
- **Chute Fantasma** (`2`, custo 30, meio ou ataque): a bola sai primeiro na diagonal **oposta** por ~320 ms, depois curva de volta com giro invertido e um efeito "FANTASMA".
- **Combo Breaker** (`3`, custo 20, meio ou ataque): o jogador "pega" a bola no pé e dá **4 rechutes** seguidos a cada 130 ms, com força crescente e efeitos "COMBO x2/x3/x4/x5".

### Auto-disparo (facilitar o uso)

Ao ativar com `1-4`, a habilidade verifica se a bola está perto de uma barra válida (alcance generoso de ~110 px horizontal / 78 px vertical). Se estiver, **ela pega a bola e executa o chute ou a defesa na hora**, com força máxima — você nem precisa segurar `→`/`←`. Se a bola estiver longe, a habilidade fica armada e disparada no próximo chute manual, como antes.

Isso vale para todas as habilidades de chute/defesa, inclusive Chute Diagonal e Bloqueio Pesado. O nome de cada habilidade aparece no termômetro na altura do seu custo.

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
| Sair da partida | `Esc` | Volta ao menu |

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
- [x] IA com três níveis de dificuldade.
- [x] Física de bola/pé e feedback visual das habilidades.
- [x] Atributos com significado próprio e orçamento de 200 pontos (heróis base e criados).
- [x] Chutes fortes escalam de verdade; carga por role (ofensivo/defensivo/coringa 30%).
- [ ] Transporte realtime da partida (PeerJS/WebSocket) e modo Online 1v1.
- [ ] Autoridade/anti-cheat da partida.
- [ ] UI de lobby/matchmaking integrada ao Firebase.
