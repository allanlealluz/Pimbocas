import "./style.css";
import { HEROES } from "./domain/heroes";
import {
  attachInputListeners,
  createInputState,
  DEFAULT_CONTROL_SCHEME,
} from "./game/input";
import {
  createDemoMatch,
  movePlayerRod,
  performKick,
  tryActivateAbility,
  updateMatch,
  type MatchState,
} from "./game/match";
import { renderField } from "./ui/field";
import { renderHud } from "./ui/hud";
import { AppFlow } from "./ui/flow";

const input = createInputState("ataque");
let match: MatchState | null = null;
let previewAbilityId: string | null = null;

const flow = new AppFlow({
  root: document.getElementById("screen-root") as HTMLElement,
  gameScreen: document.getElementById("game-screen") as HTMLElement,
  onStartMatch: (heroId, difficulty) => {
    match = createDemoMatch(heroId, difficulty);
    input.selectedRod = "ataque";
    input.moveAxis = 0;
    input.charging = null;
    previewAbilityId = null;
    renderAll();
  },
  onEndMatch: () => {
    match = null;
  },
});

function bindUi(): void {
  const markers = document.getElementById("ability-markers");
  if (!markers) return;

  const getMarkerId = (e: Event): string | null =>
    (e.target as HTMLElement).closest<HTMLElement>("[data-preview-ability]")?.getAttribute("data-preview-ability") ?? null;

  markers.addEventListener("pointerover", (e) => {
    const id = getMarkerId(e);
    if (id) previewAbilityId = id;
  });
  markers.addEventListener("pointerout", (e) => {
    if (getMarkerId(e)) previewAbilityId = null;
  });
  markers.addEventListener("focusin", (e) => {
    const id = getMarkerId(e);
    if (id) previewAbilityId = id;
  });
  markers.addEventListener("focusout", () => {
    previewAbilityId = null;
  });
  markers.addEventListener("click", (e) => {
    const id = getMarkerId(e);
    if (id && match) tryActivateAbility(match, id, performance.now());
  });
}

function renderAll(): void {
  if (!match) return;
  const canvas = document.getElementById("game") as HTMLCanvasElement | null;
  if (canvas) renderField(canvas, match, input.selectedRod, previewAbilityId, input.charging?.direction ?? null);
  renderHud(match, { previewAbilityId });
}

function syncRodCharge(now: number): void {
  if (!match) return;
  for (const rod of match.rods) {
    if (rod.side !== "left") continue;
    rod.charge = rod.id === input.selectedRod && input.charging
      ? Math.min(1, (now - input.charging.startedAtMs) / 700)
      : 0;
  }
}

attachInputListeners(window, DEFAULT_CONTROL_SCHEME, input, {
  shouldHandle: () => flow.isPlaying(),
  onKickRelease: (direction, power) => {
    if (!match) return;
    performKick(match, input.selectedRod, power, direction);
  },
  onAbilitySlot: (slotIndex) => {
    if (!match) return;
    const abilityId = match.localPlayer.hero.abilities[slotIndex];
    if (!abilityId) return;
    tryActivateAbility(match, abilityId, performance.now());
  },
});

bindUi();
Object.assign(window, { input, HEROES, flow });
Object.defineProperty(window, "match", { get: () => match, configurable: true });

let last = performance.now();
function loop(now: number): void {
  const deltaMs = Math.min(100, now - last);
  last = now;

  if (match && flow.isPlaying()) {
    if (input.moveAxis !== 0) {
      movePlayerRod(match, input.selectedRod, input.moveAxis, deltaMs);
    }
    syncRodCharge(now);
    updateMatch(match, deltaMs, now);
    renderAll();
  }
  requestAnimationFrame(loop);
}

void flow.start();
requestAnimationFrame(loop);
