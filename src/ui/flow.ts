import { listHeroes, registerCustomHero, unregisterCustomHero } from "../domain/heroes";
import type { HeroDefinition, HeroStats, Role } from "../domain/types";
import type { AiDifficulty } from "../game/match";
import {
  createFirebaseService,
  FirebaseServiceStub,
  mapAuthError,
  type FirebaseService,
  type PlayerProfile,
} from "../net/firebase";
import {
  abilityInfoHtml,
  BAR_PRESETS,
  createHeroDraft,
  draftFromHero,
  HERO_COLORS,
  ROLE_LABELS,
  STAT_BUDGET,
  STAT_KEYS,
  STAT_MAX,
  STAT_MIN,
  authScreen,
  creatorScreen,
  howToScreen,
  menuScreen,
  modesScreen,
  selectScreen,
  type AuthMode,
  type HeroDraft,
  type ScreenName,
} from "./screens";

type ImageKind = "face" | "body";

/** Reduz uploads a um data URL pequeno o suficiente para Firestore/localStorage. */
async function fileToDataUrl(file: File, maxSize: number): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Arquivo não é uma imagem.");
  if (file.size > 8 * 1024 * 1024) throw new Error("Imagem muito grande (máximo 8 MB).");
  const original = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Não foi possível abrir a imagem."));
    img.src = original;
  });
  const scale = Math.min(1, maxSize / Math.max(1, image.width, image.height));
  if (scale === 1 && original.length < 180_000) return original;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas indisponível.");
  const mime = file.type === "image/png" ? "image/png" : "image/jpeg";
  if (mime === "image/jpeg") {
    ctx.fillStyle = "#fffaf0";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  let result = canvas.toDataURL(mime, 0.82);
  // PNG com muitos detalhes pode estourar o limite do documento no Firestore.
  if (mime === "image/png" && result.length > 500_000) {
    const flat = document.createElement("canvas");
    flat.width = canvas.width;
    flat.height = canvas.height;
    const flatCtx = flat.getContext("2d");
    if (!flatCtx) return result;
    flatCtx.fillStyle = "#fffaf0";
    flatCtx.fillRect(0, 0, flat.width, flat.height);
    flatCtx.drawImage(canvas, 0, 0);
    result = flat.toDataURL("image/jpeg", 0.78);
  }
  return result;
}

export interface AppFlowOptions {
  root: HTMLElement;
  gameScreen: HTMLElement;
  onStartMatch: (heroId: string, difficulty: AiDifficulty) => void;
  onEndMatch: () => void;
}

/** Controla as telas fora do campo: auth, menu, modos, seleção e editor. */
export class AppFlow {
  private readonly root: HTMLElement;
  private readonly gameScreen: HTMLElement;
  private readonly onStartMatch: AppFlowOptions["onStartMatch"];
  private readonly onEndMatch: AppFlowOptions["onEndMatch"];
  private readonly localService = new FirebaseServiceStub();
  private service: FirebaseService = createFirebaseService();

  private screen: ScreenName = "auth";
  private paused = false;
  private authMode: AuthMode = "login";
  private profile: PlayerProfile | null = null;
  private selectedHeroId = "coringa";
  private difficulty: AiDifficulty = "medio";
  private draft: HeroDraft = createHeroDraft();
  private busy = false;

  constructor(options: AppFlowOptions) {
    this.root = options.root;
    this.gameScreen = options.gameScreen;
    this.onStartMatch = options.onStartMatch;
    this.onEndMatch = options.onEndMatch;

    this.root.addEventListener("click", (e) => this.onClick(e));
    this.root.addEventListener("submit", (e) => void this.onSubmit(e));
    this.root.addEventListener("input", (e) => void this.onInput(e));
    this.root.addEventListener("change", (e) => void this.onInput(e));
    this.root.addEventListener("mouseover", (e) => this.onAbilityHover(e));
    this.gameScreen.querySelector("[data-open-pause]")?.addEventListener("click", () => this.setPaused(true));
    this.gameScreen.querySelectorAll<HTMLElement>("[data-pause-action]").forEach((button) => {
      button.addEventListener("click", () => this.onPauseAction(button.dataset.pauseAction));
    });
    window.addEventListener("keydown", (e) => {
      if (e.code === "Escape" && this.screen === "game") {
        e.preventDefault();
        this.setPaused(!this.paused);
      }
    });
  }

  isPlaying(): boolean { return this.screen === "game" && !this.paused; }

  private setPaused(paused: boolean): void {
    this.paused = paused;
    const menu = this.gameScreen.querySelector<HTMLElement>("#pause-menu");
    if (menu) menu.hidden = !paused;
  }

  private onPauseAction(action?: string): void {
    switch (action) {
      case "resume": this.setPaused(false); break;
      case "restart": this.restartMatch(); break;
      case "select": this.changeCharacter(); break;
      case "menu": this.exitMatch(); break;
    }
  }

  async start(): Promise<void> {
    this.show("auth");
    try {
      const restored = await this.service.restoreSession();
      if (restored && !this.profile) this.acceptProfile(restored);
    } catch {
      // Sessão inválida: mantém a tela de login.
    }
  }

  // ---------- Navegação ----------

  private show(screen: ScreenName): void {
    this.screen = screen;
    this.root.hidden = screen === "game";
    this.gameScreen.hidden = screen !== "game";
    if (screen !== "game") this.setPaused(false);
    if (screen !== "game") this.render();
  }

  private render(): void {
    if (!this.profile && this.screen !== "auth") {
      this.screen = "auth";
      this.root.hidden = false;
      this.gameScreen.hidden = true;
    }
    const profile = this.profile;
    let html: string;
    switch (this.screen) {
      case "auth": html = authScreen(this.authMode); break;
      case "menu": html = menuScreen(profile!); break;
      case "modes": html = modesScreen(profile!, this.difficulty); break;
      case "select": html = selectScreen(profile!); break;
      case "creator": html = creatorScreen(profile!, this.draft); break;
      case "howto": html = howToScreen(); break;
      default: html = menuScreen(profile!);
    }
    this.root.innerHTML = html;
  }

  private startMatch(): void {
    if (!this.profile) return;
    this.setPaused(false);
    this.show("game");
    this.onStartMatch(this.selectedHeroId, this.difficulty);
  }

  private restartMatch(): void {
    if (!this.profile) return;
    this.setPaused(false);
    this.onStartMatch(this.selectedHeroId, this.difficulty);
  }

  private changeCharacter(): void {
    if (!this.profile) return;
    this.setPaused(false);
    this.onEndMatch();
    this.show("select");
  }

  private exitMatch(): void {
    this.setPaused(false);
    this.onEndMatch();
    this.show("menu");
  }

  private acceptProfile(profile: PlayerProfile): void {
    // Heróis salvos com o orçamento antigo são rebalanceados ao entrar.
    const customHeroes = profile.customHeroes
      .filter((hero) => hero.id !== "coringa")
      .map((hero) => registerCustomHero(hero));
    const selectedHeroId = listHeroes().some((h) => h.id === profile.selectedHeroId)
      ? profile.selectedHeroId
      : "coringa";
    this.profile = { ...profile, customHeroes, selectedHeroId };
    this.selectedHeroId = selectedHeroId;
    this.show("menu");
  }

  private setError(message: string): void {
    const el = this.root.querySelector<HTMLElement>("[data-error]");
    if (el) el.textContent = message;
    else console.warn("[Pimbocas]", message);
  }

  private showAbilityInfo(id: string, count?: number): void {
    const panel = this.root.querySelector<HTMLElement>("[data-ability-info]");
    if (!panel) return;
    const total = count || this.draft.abilities.length || 4;
    panel.dataset.abilityInfoId = id;
    panel.innerHTML = abilityInfoHtml(id, total);
  }

  private onAbilityHover(event: MouseEvent): void {
    if (this.busy) return;
    const el = (event.target as HTMLElement).closest<HTMLElement>("[data-ability-info-id]");
    if (!el?.dataset.abilityInfoId) return;
    const panel = this.root.querySelector<HTMLElement>("[data-ability-info]");
    if (!panel || panel.dataset.abilityInfoId === el.dataset.abilityInfoId) return;
    this.showAbilityInfo(el.dataset.abilityInfoId, Number(el.dataset.abilityCount) || undefined);
  }

  private setBusy(busy: boolean): void {
    this.busy = busy;
    this.root.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
      button.disabled = busy;
    });
  }

  private async run(action: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.setBusy(true);
    try {
      await action();
    } catch (error) {
      this.setError(mapAuthError(error));
    } finally {
      this.setBusy(false);
    }
  }

  // ---------- Eventos ----------

  private onClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    const infoEl = target.closest<HTMLElement>("[data-ability-info-id]");
    if (infoEl?.dataset.abilityInfoId) {
      const count = Number(infoEl.dataset.abilityCount);
      this.showAbilityInfo(infoEl.dataset.abilityInfoId, count || undefined);
    }
    const el = target.closest<HTMLElement>(
      "[data-action],[data-auth-tab],[data-select-hero],[data-edit-hero],[data-delete-hero],[data-difficulty],[data-color],[data-bar-preset]",
    );
    if (!el || this.busy) return;

    if (el.dataset.authTab) {
      this.authMode = el.dataset.authTab as AuthMode;
      this.render();
      return;
    }
    if (el.dataset.selectHero) {
      void this.run(async () => {
        await this.service.saveSelectedHero(this.profile!.uid, el.dataset.selectHero!);
        this.profile!.selectedHeroId = el.dataset.selectHero!;
        this.selectedHeroId = el.dataset.selectHero!;
        this.render();
      });
      return;
    }
    if (el.dataset.editHero) {
      const hero = this.profile?.customHeroes.find((h) => h.id === el.dataset.editHero);
      if (!hero) return;
      this.draft = draftFromHero(hero);
      this.show("creator");
      return;
    }
    if (el.dataset.deleteHero) {
      void this.run(async () => {
        const hero = this.profile?.customHeroes.find((h) => h.id === el.dataset.deleteHero);
        if (!hero || !window.confirm(`Excluir ${hero.name}?`)) return;
        const profile = this.profile!;
        profile.customHeroes = profile.customHeroes.filter((h) => h.id !== hero.id);
        if (profile.selectedHeroId === hero.id) profile.selectedHeroId = "coringa";
        unregisterCustomHero(hero.id);
        await this.service.saveProfile(profile);
        await this.service.saveSelectedHero(profile.uid, profile.selectedHeroId);
        this.selectedHeroId = profile.selectedHeroId;
        this.render();
      });
      return;
    }
    if (el.dataset.difficulty) {
      this.difficulty = el.dataset.difficulty as AiDifficulty;
      this.render();
      return;
    }
    if (el.dataset.color) {
      this.draft.color = el.dataset.color;
      this.root.querySelectorAll<HTMLElement>("[data-color]").forEach((swatch) => {
        swatch.classList.toggle("active", swatch.dataset.color === this.draft.color);
      });
      const preview = this.root.querySelector<HTMLElement>(".creator-preview");
      const avatar = this.root.querySelector<HTMLElement>(".preview-avatar");
      if (preview) preview.style.setProperty("--hero-color", this.draft.color);
      if (avatar) avatar.style.setProperty("--hero-color", this.draft.color);
      return;
    }
    if (el.dataset.barPreset) {
      this.draft.barPreset = el.dataset.barPreset as HeroDraft["barPreset"];
      this.root.querySelectorAll<HTMLElement>("[data-bar-preset]").forEach((preset) => {
        preset.classList.toggle("active", preset.dataset.barPreset === this.draft.barPreset);
      });
      return;
    }

    switch (el.dataset.action) {
      case "play": this.show("modes"); break;
      case "menu": this.show("menu"); break;
      case "select": this.show("select"); break;
      case "creator":
        this.draft = createHeroDraft();
        this.show("creator");
        break;
      case "howto": this.show("howto"); break;
      case "start-match": this.startMatch(); break;
      case "google":
        void this.run(async () => this.acceptProfile(await this.service.signInWithGoogle()));
        break;
      case "guest":
        void this.run(async () => this.acceptProfile(await this.service.signInAsGuest()));
        break;
      case "local":
        void this.run(async () => {
          this.service = this.localService;
          this.acceptProfile(await this.localService.restoreSession() ?? await this.localService.signIn());
        });
        break;
      case "logout":
        void this.run(async () => {
          await this.service.signOut();
          this.service = createFirebaseService();
          this.profile = null;
          this.authMode = "login";
          this.show("auth");
        });
        break;
    }
  }

  private async onSubmit(event: Event): Promise<void> {
    const form = event.target as HTMLFormElement;
    event.preventDefault();
    if (form.dataset.form === "auth") {
      const data = new FormData(form);
      const email = String(data.get("email") ?? "").trim();
      const password = String(data.get("password") ?? "");
      const name = String(data.get("name") ?? "").trim();
      await this.run(async () => {
        const profile = this.authMode === "register"
          ? await this.service.signUpWithEmail(name, email, password)
          : await this.service.signInWithEmail(email, password);
        this.acceptProfile(profile);
      });
      return;
    }
    if (form.dataset.form === "creator") {
      await this.run(async () => this.saveCustomHero());
    }
  }

  private async onInput(event: Event): Promise<void> {
    const el = event.target as HTMLInputElement | HTMLSelectElement;
    const imageKind = el.dataset?.image as ImageKind | undefined;
    if (imageKind === "face" || imageKind === "body") {
      const file = (el as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const dataUrl = await fileToDataUrl(file, imageKind === "face" ? 256 : 512);
        if (imageKind === "face") this.draft.faceImage = dataUrl;
        else this.draft.bodyImage = dataUrl;
        const preview = this.root.querySelector<HTMLElement>(`[data-image-preview="${imageKind}"]`);
        if (preview) preview.innerHTML = `<img src="${dataUrl}" alt="">`;
        if (imageKind === "face") {
          const avatar = this.root.querySelector<HTMLElement>(".preview-avatar");
          let img = avatar?.querySelector<HTMLImageElement>(".avatar-face");
          if (avatar && !img) {
            img = document.createElement("img");
            img.className = "avatar-face";
            avatar.prepend(img);
          }
          if (img) img.src = dataUrl;
        } else {
          const bodyPreview = this.root.querySelector<HTMLElement>("[data-body-preview]");
          if (bodyPreview) bodyPreview.innerHTML = `<img class="hero-body-art preview-body" src="${dataUrl}" alt="Corpo do herói">`;
        }
      } catch (error) {
        this.setError(error instanceof Error ? error.message : "Não foi possível ler a imagem.");
      }
      return;
    }
    const nameField = el.dataset?.draftInput;
    if (nameField === "name") {
      this.draft.name = el.value;
      const preview = this.root.querySelector<HTMLElement>("[data-preview-name]");
      const avatarText = this.root.querySelector<HTMLElement>(".preview-avatar span");
      if (preview) preview.textContent = el.value.trim() || "Novo Herói";
      if (avatarText) {
        avatarText.textContent = (el.value.trim().split(/\s+/).slice(0, 2).map((p) => p[0] ?? "").join("").toUpperCase()) || "?";
      }
      return;
    }
    if (nameField === "role") {
      this.draft.role = el.value as Role;
      const label = this.root.querySelector<HTMLElement>("[data-preview-role]");
      if (label) label.textContent = ROLE_LABELS[this.draft.role];
      return;
    }
    if (el.dataset?.stat) {
      const key = el.dataset.stat as keyof HeroStats;
      const value = Math.max(STAT_MIN, Math.min(STAT_MAX, Number(el.value)));
      this.draft.stats[key] = value;
      const statValue = this.root.querySelector<HTMLElement>(`[data-stat-value="${key}"]`);
      const statBar = this.root.querySelector<HTMLElement>(`[data-stat-bar="${key}"]`);
      const statText = this.root.querySelector<HTMLElement>(`[data-stat-text="${key}"]`);
      if (statValue) statValue.textContent = String(value);
      if (statBar) statBar.style.width = `${value}%`;
      if (statText) statText.textContent = String(value);
      this.updateBudget();
      return;
    }
    if (el.dataset?.ability !== undefined) {
      const checkbox = el as HTMLInputElement;
      if (checkbox.checked && this.draft.abilities.length >= 4) {
        checkbox.checked = false;
        this.setError("Escolha no máximo 4 habilidades.");
        return;
      }
      this.draft.abilities = Array.from(this.root.querySelectorAll<HTMLInputElement>("input[data-ability]:checked"))
        .map((input) => input.value);
      const total = this.root.querySelector<HTMLElement>("[data-ability-total]");
      if (total) total.textContent = String(this.draft.abilities.length);
      this.root.querySelectorAll<HTMLElement>("[data-ability-info-id][data-ability-count]").forEach((option) => {
        option.dataset.abilityCount = String(this.draft.abilities.length);
      });
      const panel = this.root.querySelector<HTMLElement>("[data-ability-info]");
      if (panel?.dataset.abilityInfoId) {
        panel.innerHTML = abilityInfoHtml(panel.dataset.abilityInfoId, this.draft.abilities.length || 2);
      }
    }
  }

  private updateBudget(): void {
    const total = STAT_KEYS.reduce((sum, key) => sum + this.draft.stats[key], 0);
    const el = this.root.querySelector<HTMLElement>("[data-budget]");
    if (el) {
      el.textContent = String(total);
      el.parentElement?.classList.toggle("over-budget", total > STAT_BUDGET);
    }
  }

  private async saveCustomHero(): Promise<void> {
    const profile = this.profile;
    if (!profile) return;
    const name = this.draft.name.trim();
    const total = STAT_KEYS.reduce((sum, key) => sum + this.draft.stats[key], 0);
    if (name.length < 2) return this.setError("Dê um nome com pelo menos 2 caracteres.");
    if (total > STAT_BUDGET) return this.setError(`Você gastou ${total} pontos; o limite é ${STAT_BUDGET}.`);
    if (this.draft.abilities.length < 2) return this.setError("Escolha pelo menos 2 habilidades.");
    if (this.draft.abilities.length > 4) return this.setError("Escolha no máximo 4 habilidades.");

    const preset = BAR_PRESETS.find((p) => p.id === this.draft.barPreset) ?? BAR_PRESETS[1];
    const hero: HeroDefinition = {
      id: this.draft.id ?? `custom_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      name,
      role: this.draft.role,
      description: `Personagem criado por ${profile.displayName}. Barra ${preset.label.toLowerCase()} e estilo ${ROLE_LABELS[this.draft.role].toLowerCase()}.`,
      stats: { ...this.draft.stats },
      specialBar: { segments: [...preset.segments] },
      abilities: [...this.draft.abilities],
      color: HERO_COLORS.includes(this.draft.color) ? this.draft.color : HERO_COLORS[2],
      faceImage: this.draft.faceImage,
      bodyImage: this.draft.bodyImage,
      custom: true,
    };

    const savedHero = registerCustomHero(hero);
    profile.customHeroes = this.draft.id
      ? profile.customHeroes.map((h) => h.id === savedHero.id ? savedHero : h)
      : [...profile.customHeroes, savedHero];
    profile.selectedHeroId = savedHero.id;
    await this.service.saveProfile(profile);
    await this.service.saveSelectedHero(profile.uid, savedHero.id);
    this.selectedHeroId = hero.id;
    this.show("select");
  }
}
