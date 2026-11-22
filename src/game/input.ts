import type { RodId } from "../domain/types";

export interface RodControlBinding {
  rod: RodId;
  key: string; // KeyboardEvent.code
  label: string;
}

export interface ControlScheme {
  rods: RodControlBinding[];
  moveUp: string;
  moveDown: string;
  /** Seta direita: chute para frente (sentido do ataque) */
  kickForward: string;
  /** Seta esquerda: chute para trás */
  kickBackward: string;
  abilitySlots: string[];
}

export const DEFAULT_CONTROL_SCHEME: ControlScheme = {
  rods: [
    { rod: "goleiro", key: "KeyQ", label: "Q" },
    { rod: "defesa", key: "KeyW", label: "W" },
    { rod: "meio", key: "KeyE", label: "E" },
    { rod: "ataque", key: "KeyR", label: "R" },
  ],
  moveUp: "ArrowUp",
  moveDown: "ArrowDown",
  kickForward: "ArrowRight",
  kickBackward: "ArrowLeft",
  abilitySlots: ["Digit1", "Digit2", "Digit3", "Digit4"],
};

export interface KickChargeState {
  /** 1 = frente, -1 = trás */
  direction: 1 | -1;
  startedAtMs: number;
}

export interface InputState {
  selectedRod: RodId;
  moveAxis: -1 | 0 | 1;
  charging: KickChargeState | null;
  /** Última força de chute calculada ao soltar (0-1) */
  lastKickPower: number | null;
}

export interface InputEvents {
  /** Permite desativar o input enquanto menus estão abertos. */
  shouldHandle?: () => boolean;
  onRodSelect?: (rod: RodId) => void;
  onKickRelease?: (direction: 1 | -1, power01: number, holdMs: number) => void;
  onAbilitySlot?: (slotIndex: number) => void;
  onMoveAxis?: (axis: -1 | 0 | 1) => void;
}

const MIN_KICK_HOLD_MS = 60;
const MAX_KICK_HOLD_MS = 700;

export function createInputState(defaultRod: RodId = "ataque"): InputState {
  return {
    selectedRod: defaultRod,
    moveAxis: 0,
    charging: null,
    lastKickPower: null,
  };
}

export function getRodForKey(scheme: ControlScheme, code: string): RodId | null {
  return scheme.rods.find((r) => r.key === code)?.rod ?? null;
}

export function getAbilitySlotForKey(scheme: ControlScheme, code: string): number | null {
  const idx = scheme.abilitySlots.indexOf(code);
  return idx >= 0 ? idx : null;
}

export function clampKickPower(holdMs: number): number {
  const clamped = Math.max(MIN_KICK_HOLD_MS, Math.min(MAX_KICK_HOLD_MS, holdMs));
  return (clamped - MIN_KICK_HOLD_MS) / (MAX_KICK_HOLD_MS - MIN_KICK_HOLD_MS);
}

export function attachInputListeners(
  target: Window,
  scheme: ControlScheme,
  state: InputState,
  events: InputEvents = {},
): () => void {
  const directionForKey = (code: string): 1 | -1 | null => {
    if (code === scheme.kickForward) return 1;
    if (code === scheme.kickBackward) return -1;
    return null;
  };

  const canHandle = (e: KeyboardEvent): boolean => {
    if (events.shouldHandle && !events.shouldHandle()) return false;
    const target = e.target as HTMLElement | null;
    if (target?.closest?.("input, textarea, select, [contenteditable='true']")) return false;
    return true;
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat || !canHandle(e)) return;

    const rod = getRodForKey(scheme, e.code);
    if (rod) {
      e.preventDefault();
      state.selectedRod = rod;
      events.onRodSelect?.(rod);
      return;
    }

    const kickDir = directionForKey(e.code);
    if (kickDir !== null) {
      e.preventDefault();
      // Enquanto carrega, ignora a outra seta para não trocar de ideia no meio do gesto.
      if (!state.charging) {
        state.charging = { direction: kickDir, startedAtMs: performance.now() };
      }
      return;
    }

    if (e.code === scheme.moveUp) {
      e.preventDefault();
      state.moveAxis = -1;
      events.onMoveAxis?.(state.moveAxis);
      return;
    }
    if (e.code === scheme.moveDown) {
      e.preventDefault();
      state.moveAxis = 1;
      events.onMoveAxis?.(state.moveAxis);
      return;
    }

    const slot = getAbilitySlotForKey(scheme, e.code);
    if (slot !== null) {
      e.preventDefault();
      events.onAbilitySlot?.(slot);
    }
  };

  const onKeyUp = (e: KeyboardEvent) => {
    if (!canHandle(e)) return;
    const kickDir = directionForKey(e.code);
    if (kickDir !== null && state.charging && state.charging.direction === kickDir) {
      e.preventDefault();
      const holdMs = performance.now() - state.charging.startedAtMs;
      const power = clampKickPower(holdMs);
      state.lastKickPower = power;
      state.charging = null;
      events.onKickRelease?.(kickDir, power, holdMs);
      return;
    }

    if (e.code === scheme.moveUp && state.moveAxis === -1) {
      state.moveAxis = 0;
      events.onMoveAxis?.(0);
    }
    if (e.code === scheme.moveDown && state.moveAxis === 1) {
      state.moveAxis = 0;
      events.onMoveAxis?.(0);
    }
  };

  target.addEventListener("keydown", onKeyDown);
  target.addEventListener("keyup", onKeyUp);
  return () => {
    target.removeEventListener("keydown", onKeyDown);
    target.removeEventListener("keyup", onKeyUp);
  };
}
