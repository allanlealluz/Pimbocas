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

export const CONTROL_STORAGE_KEY = "pimbocas.controls.v1";

export function cloneControlScheme(scheme: ControlScheme): ControlScheme {
  return {
    rods: scheme.rods.map((binding) => ({ ...binding })),
    moveUp: scheme.moveUp,
    moveDown: scheme.moveDown,
    kickForward: scheme.kickForward,
    kickBackward: scheme.kickBackward,
    abilitySlots: [...scheme.abilitySlots],
  };
}

const KEY_LABELS: Record<string, string> = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Space: "Espaço",
  Escape: "Esc",
  Enter: "Enter",
  NumpadEnter: "Enter",
  Backspace: "Backspace",
  ShiftLeft: "Shift",
  ShiftRight: "Shift",
  ControlLeft: "Ctrl",
  ControlRight: "Ctrl",
  AltLeft: "Alt",
  AltRight: "Alt",
};

export function keyLabel(code: string): string {
  if (KEY_LABELS[code]) return KEY_LABELS[code]!;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return `Num ${code.slice(6)}`;
  return code;
}

interface BindingEntry { id: string; code: string; }

function collectBindings(scheme: ControlScheme): BindingEntry[] {
  return [
    ...scheme.rods.map((binding) => ({ id: binding.rod, code: binding.key })),
    { id: "moveUp", code: scheme.moveUp },
    { id: "moveDown", code: scheme.moveDown },
    { id: "kickForward", code: scheme.kickForward },
    { id: "kickBackward", code: scheme.kickBackward },
    ...scheme.abilitySlots.map((code, index) => ({ id: `ability${index + 1}`, code })),
  ];
}

export function getBinding(scheme: ControlScheme, id: string): string | null {
  return collectBindings(scheme).find((binding) => binding.id === id)?.code ?? null;
}

function setBindingCode(scheme: ControlScheme, id: string, code: string): boolean {
  const rod = scheme.rods.find((binding) => binding.rod === id);
  if (rod) { rod.key = code; return true; }
  if (id === "moveUp") { scheme.moveUp = code; return true; }
  if (id === "moveDown") { scheme.moveDown = code; return true; }
  if (id === "kickForward") { scheme.kickForward = code; return true; }
  if (id === "kickBackward") { scheme.kickBackward = code; return true; }
  const ability = /^ability([1-4])$/.exec(id);
  if (ability) {
    const index = Number(ability[1]) - 1;
    if (index >= 0 && index < scheme.abilitySlots.length) {
      scheme.abilitySlots[index] = code;
      return true;
    }
  }
  return false;
}

const RESERVED_KEYS = new Set(["Escape", "Tab", "F5", "F11", "F12"]);

/** Retorna o id da binding conflitante, ou null se a tecla estiver livre. */
export function findBindingConflict(scheme: ControlScheme, id: string, code: string): string | null {
  if (RESERVED_KEYS.has(code)) return "reserved";
  return collectBindings(scheme).find((binding) => binding.id !== id && binding.code === code)?.id ?? null;
}

export function setBinding(scheme: ControlScheme, id: string, code: string): boolean {
  if (findBindingConflict(scheme, id, code)) return false;
  return setBindingCode(scheme, id, code);
}

export function loadControlScheme(): ControlScheme {
  const scheme = cloneControlScheme(DEFAULT_CONTROL_SCHEME);
  try {
    const raw = localStorage.getItem(CONTROL_STORAGE_KEY);
    if (!raw) return scheme;
    const parsed = JSON.parse(raw) as Partial<ControlScheme>;
    for (const binding of parsed.rods ?? []) {
      if (binding && typeof binding.rod === "string" && typeof binding.key === "string") {
        setBindingCode(scheme, binding.rod, binding.key);
      }
    }
    for (const id of ["moveUp", "moveDown", "kickForward", "kickBackward"] as const) {
      const code = parsed[id];
      if (typeof code === "string") setBindingCode(scheme, id, code);
    }
    if (Array.isArray(parsed.abilitySlots)) {
      parsed.abilitySlots.slice(0, scheme.abilitySlots.length).forEach((code, index) => {
        if (typeof code === "string") scheme.abilitySlots[index] = code;
      });
    }
  } catch {
    // Configuração corrompida: volta ao padrão.
  }
  return scheme;
}

export function saveControlScheme(scheme: ControlScheme): void {
  try {
    localStorage.setItem(CONTROL_STORAGE_KEY, JSON.stringify(scheme));
  } catch {
    // localStorage indisponível: controles valem só nesta sessão.
  }
}

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
