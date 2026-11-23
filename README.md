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
3. **Modo de jogo**: **Contra a IA** e **Online 1v1 por sala** estão disponíveis. A dificuldade da IA altera velocidade de perseguição, chance de chute, herói e freqüência com que ela usa habilidades: **Fácil** → Kenji, **Médio** → Jhonas, **Difícil** → Gulias.
4. **Seleção de personagens**: cartões com atributos, role, habilidades e formato da barra; personagens criados podem ser editados ou excluídos.
5. **Editor de heróis**: qualquer um dos sete heróis oficiais pode ser editado (nome, cor, role, atributos com orçamento de **200 pontos**, formato da barra, **de 2 a 4 habilidades** e uploads opcionais de rosto/corpo). Imagens são reduzidas no navegador para data URL antes de salvar. As edições vão para a coleção global `heroes` no Firestore e valem para todos os jogadores; sem Firebase, ficam no `localStorage`.
6. **Visual**: tema arcade/esports escuro com laranja, ciano e lima. Na seleção, passe o mouse ou clique no nome de uma habilidade para ver descrição, barra, gatilho, custo, recuperação e bônus de poder.
7. **Partida**: o campo ocupa a tela. O botão "☰ Menu" (ou `Esc`) abre o menu da partida, com **Continuar**, **Reiniciar partida**, **Trocar personagem** e **Voltar ao menu**. A simulação fica pausada enquanto o menu está aberto.

O elenco é persistido na coleção global `heroes` do Firestore (ou no modo local, quando sem conta). O herói selecionado fica no perfil do jogador.

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

## Identidade de role

Além da forma de carregar a barra, a role dá um bônus fixo de **5%**, aplicado depois dos stats e do bônus por quantidade de habilidades:

| Role | Bônus |
|---|---|
| Ofensivo | **+5% de força de chute** |
| Defensivo | **+5% de drenagem da bola** no contato |
| Coringa | **+5% de velocidade da barra** |

É um empurrão pequeno de identidade: não substitui os atributos, que continuam sendo o principal fator de diferença entre os heróis.

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

O elenco oficial tem exatamente sete heróis (todos com 200 pontos):

| Herói | Role | Barra | Habilidades | Bônus |
|---|---|---|---|---|
| **Allan** | Ofensivo | 20 / 30 / 50 | Combo Breaker, Chute Fantasma, Cruzador Estelar | +12% |
| **Paulo** | Coringa | 30 / 30 / 40 | Chute Relâmpago, **Cópia** | +25% |
| **Jhonas a Sombra** | Ofensivo | 50 / 50 | Chute de Goleiro, **Roletada** | +25% |
| **Kenji** | Coringa | 20 / 30 / 50 | Leitura de Jogo, Chute Diagonal, Bloqueio Pesado, Rebote | padrão |
| **Gulias** | Defensivo | 50 / 50 | **Força Bruta**, **Chute de Goleiro**, **Mão Grande** | +12% |
| **Os Gêmeos** | Defensivo | 30 / 30 / 40 | **Chute Duplo**, Rebote, **Sequência de Toques** | +12% |
| **Churrasqueiro** | Coringa | 50 / 50 | **Rotacionar**, **Explosão** | +25% |

**Allan** é o canhoneiro da mesa: `100 / 40 / 35 / 15 / 10` (total 200), cor `#ff6bd6`. Ele troca quase tudo pelo chute mais forte do jogo e usa três habilidades — Combo Breaker, Chute Fantasma e Cruzador Estelar — com **+12% de poder** cada. O Elástico não faz parte do kit dele.

**Paulo** é o ladrão de jogadas: `60 / 55 / 45 / 20 / 20` (total 200). A **Cópia** rouba uma habilidade de outro herói na mesa — priorizando o adversário — por 9 s. O slot copiado aparece no HUD, não gasta energia e **só dispara quando você aperta a tecla dele**.

**Jhonas a Sombra** é atacante: `80 / 25 / 30 / 20 / 45` (total 200). A **Roletada** é uma bomba sem controle: sai muito mais rápido, com giro e direção imprevisíveis, e trava o manete por 1,4 s.

**Kenji** é coringa tático: `45 / 40 / 40 / 45 / 30` (total 200). Usa Leitura de Jogo, Chute Diagonal, Bloqueio Pesado e o **Rebote**, que devolve um chute forte quando a bola bate na defesa.

**Gulias** é o muro: `45 / 55 / 10 / 80 / 10` (total 200). Defesa muito alta, força e controle acima da média, mas lentidão extrema. Usa **Força Bruta**, **Chute de Goleiro** e **Mão Grande**.

**Os Gêmeos** são a defesa equilibrada: `40 / 50 / 45 / 45 / 20` (total 200). O **Chute Duplo** leva a bola do meio ao ataque num passe alinhado e termina com arremate reforçado; a **Sequência de Toques** sai do zagueiro até o meio devagar, colada na linha do boneco que vai receber. Compartilham o **Rebote** com o Kenji.

**Churrasqueiro** é o coringa da grelha: `55 / 45 / 50 / 30 / 20` (total 200). **Rotacionar** faz o meio-campo girar por ~3,2 s e devolver a bola na direção de onde ela veio (frente ou trás). **Explosão** comprime a bola, dá um pulo curto à frente e a solta rodando ao gol. Como são só duas habilidades, cada uma tem **+25% de poder**.

### As 19 habilidades

Todas respondem ao atributo correspondente — personagens com o stat alto deixam a habilidade mais forte. **Não existe habilidade exclusiva:** no criador, qualquer herói pode equipar qualquer uma das 19, incluindo Mão Grande, Chute Diagonal e Explosão. O negrito na tabela dos heróis apenas destaca a habilidade característica do herói oficial.

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
| Cópia | 30 | qualquer | Empresta uma habilidade de outro herói por 9 s como slot extra (sem custo); prioriza o adversário |
| Roletada | 40 | qualquer | Chute muito mais forte e sem controle; trava o manete por ~1,4 s |
| Rebote | 30 | goleiro/defesa | Boneco no aguardo por 3,2 s; se a bola bater nele, contra-ataca forte (1 vez por ativação) |
| Chute Duplo | 30 | meio | Passe do meio para um atacante, perfeitamente alinhado, com arremate final reforçado |
| Sequência de Toques | 25 | defesa | Toque devagar do zagueiro ao meio na linha exata do boneco receptor |
| Rotacionar | 35 | meio | Meio gira por ~3,2 s e devolve a primeira bola que chegar para frente ou para trás |
| Explosão | 45 | meio/ataque | Comprime, pula um pouco à frente e sai rodando ao gol com giro extra |

### Auto-disparo (facilitar o uso)

Ao ativar com `1-4`, a habilidade verifica se a bola está perto de uma barra válida (alcance generoso de ~110 px horizontal / 78 px vertical). Se estiver, **ela pega a bola e executa o chute ou a defesa na hora**, com força máxima — você nem precisa segurar `→`/`←`. Se a bola estiver longe, a habilidade fica armada e disparada no próximo chute manual, como antes.

Isso vale para todas as habilidades de chute/defesa, inclusive Chute Diagonal, Bloqueio Pesado, Chute Duplo, Sequência de Toques e Explosão. Rotacionar é diferente: é ativada na hora e o meio fica girando até a bola chegar. O nome de cada habilidade aparece no termômetro na altura do seu custo.

### IA também joga com habilidades

O adversário tem herói, barra de especial, carga por chutes/defesas e **usa as próprias habilidades sozinho**. A barra dele aparece no canto superior esquerdo com o nome do herói e os slots (acesos quando há energia, verdes quando estão ativos). Os avisos na tela vêm com o prefixo `IA ·`.

- A cada dificuldade corresponde um herói e uma taxa de ativação: Fácil (Kenji, 0,12/s), Médio (Jhonas, 0,25/s) e Difícil (Gulias, 0,4/s).
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

### Remapeando as teclas

No menu principal, clique em **⌨ Controles**. Clique no botão da tecla que quer trocar e pressione a nova; `Esc` cancela a troca. Teclas já usadas ou reservadas pelo navegador são recusadas com uma mensagem. O esquema fica salvo no `localStorage` (`pimbocas.controls.v1`), então continua valendo depois de fechar a página. O botão **Restaurar padrão** volta às teclas da tabela acima.

Os hints dentro do jogo e a tela **Como jogar** mostram as teclas configuradas, e as novas teclas passam a valer imediatamente — inclusive no online.

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

## Online 1v1 (sala por código)

O modo online não usa Cloud Functions nem depende do Firebase:

1. No menu, entre em **Jogar → Online 1v1**.
2. Clique em **Criar sala**. Você recebe um código tipo `PIMBO-K7X9QA`.
3. Envie o código para o amigo. Ele entra em **Online 1v1**, digita o código e clica em **Entrar na sala**.
4. Quem cria é o **host**: simula a física e envia snapshots. Quem entra envia apenas inputs e habilidades.

Funciona com qualquer forma de login, inclusive **Jogar sem conta**. A sinalização usa o servidor público do PeerJS, e a mídia usa WebRTC com STUN; redes muito restritas podem exigir TURN.

O transporte usa dois canais: **controle** (confiável, para input/chute/habilidade) e **estado** (não-confiável, para snapshots a ~30 Hz). O cliente interpola os snapshots e faz predição local da própria barra; o host zera o input remoto se ficar 250 ms sem heartbeat (evita barra "colada" quando o `keyup` se perde). O histórico enviado nos snapshots é limitado para não inflar os pacotes.

Para diagnosticar lag, abra o console no navegador do cliente e chame `netStats()`. Ele mostra `rttMs` (latência ida-e-volta), `receivedSnapshots` e `isHost`.

### Testando com outra pessoa (tunnel)

Com o `npm run dev` rodando, em outro terminal:

```bash
cloudflared tunnel --url http://localhost:5173
```

O comando imprime uma URL `https://<algo>.trycloudflare.com`. Abra nos dois navegadores, crie a sala em um e entre com o código no outro. O `vite.config.ts` já libera hosts externos no dev server.

Para publicar de verdade, o build estático (`npm run build` → `dist/`) pode ir para **Cloudflare Pages** ou **Workers Static Assets**. O Firebase Web SDK continua funcionando no navegador; só lembre de definir as variáveis `VITE_FIREBASE_*` no build e autorizar o domínio no Firebase Auth.

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
- [x] 19 habilidades que escalam com os stats; poder extra para heróis com 2 ou 3 habilidades.
- [x] Painel de detalhes das habilidades (barra, gatilho, custo, cooldown e bônus).
- [x] Upload de rosto e corpo inteiro no criador (placeholders quando não há imagem).
- [x] Menu dentro da partida: pausa, reiniciar, trocar personagem e voltar ao menu.
- [x] Elenco oficial: Allan, Paulo (Cópia), Jhonas (Roletada), Kenji (Rebote), Gulias (Mão Grande), Os Gêmeos (coreografia) e Churrasqueiro (rotação/explosão).
- [x] Queda natural da mesa puxando a bola para o gol em cada metade do campo.
- [x] Tema arcade/esports escuro no login e menus; campo limpo, sem títulos/painéis no jogo.
- [x] Fogo na arena após 60 s sem gol, vitória por 3 pontos e stack ao chegar a 10.
- [x] Transporte realtime da partida (PeerJS/WebRTC) e modo Online 1v1 por sala.
- [x] UI de sala: criar, copiar código e entrar.
- [ ] Autoridade/anti-cheat robusto (hoje o host é autoritativo, mas roda no navegador).
- [ ] Servidor autoritativo com Durable Object (evolução do transporte).
