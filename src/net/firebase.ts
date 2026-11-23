import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  signInAnonymously,
  GoogleAuthProvider,
  signInWithPopup,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
  signOut,
  onAuthStateChanged,
  type Auth,
  type User,
} from "firebase/auth";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
  collection,
  query,
  where,
  limit,
  getDocs,
  runTransaction,
  deleteDoc,
  type Firestore,
} from "firebase/firestore";
import { HEROES } from "../domain/heroes";
import { normalizeHeroStats } from "../domain/stats";
import type { HeroDefinition } from "../domain/types";

export interface PlayerProfile {
  uid: string;
  displayName: string;
  unlockedHeroes: string[];
  selectedHeroId: string;
  mmr: number;
  /** Personagens criados no editor, salvos junto do perfil do jogador. */
  customHeroes: HeroDefinition[];
}

export interface FirebaseService {
  signIn(): Promise<PlayerProfile>;
  signInWithEmail(email: string, password: string): Promise<PlayerProfile>;
  signUpWithEmail(name: string, email: string, password: string): Promise<PlayerProfile>;
  signInWithGoogle(): Promise<PlayerProfile>;
  signInAsGuest(): Promise<PlayerProfile>;
  restoreSession(): Promise<PlayerProfile | null>;
  signOut(): Promise<void>;
  getProfile(uid: string): Promise<PlayerProfile | null>;
  saveProfile(profile: PlayerProfile): Promise<void>;
  saveSelectedHero(uid: string, heroId: string): Promise<void>;
  /** Elenco global: o mesmo para todos os jogadores, salvo na coleção `heroes`. */
  listHeroes(): Promise<HeroDefinition[]>;
  saveHero(hero: HeroDefinition): Promise<void>;
}

export interface MatchmakingTicket {
  uid: string;
  mmr: number;
  heroId: string;
  /** Id usado no PeerJS para receber a conexão do host. */
  peerId?: string;
  displayName?: string;
  status: "queued" | "matched" | "cancelled";
  matchId?: string;
}

export interface MatchRecord {
  status: string;
  mode: string;
  players: Array<{
    uid: string;
    mmr: number;
    heroId?: string;
    peerId?: string;
    displayName?: string;
  }>;
}

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export function hasFirebaseConfig(): boolean {
  return Object.values(firebaseConfig).every((v) => typeof v === "string" && v.length > 0);
}

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;

export function getFirebaseApp(): FirebaseApp {
  if (!hasFirebaseConfig()) {
    throw new Error("Firebase config ausente. Preencha o .env com as chaves VITE_FIREBASE_*.");
  }
  if (!app) {
    app = getApps().length ? getApps()[0]! : initializeApp(firebaseConfig);
  }
  return app;
}

export function getFirebaseAuth(): Auth {
  if (!auth) auth = getAuth(getFirebaseApp());
  return auth;
}

export function getDb(): Firestore {
  if (!db) db = getFirestore(getFirebaseApp());
  return db;
}

/** Firestore rejeita `undefined`: normaliza campos opcionais antes de gravar. */
function toHeroDocument(hero: HeroDefinition): Record<string, unknown> {
  return {
    id: hero.id,
    name: hero.name,
    role: hero.role,
    description: hero.description,
    stats: normalizeHeroStats(hero.stats),
    specialBar: { segments: [...hero.specialBar.segments] },
    abilities: [...hero.abilities],
    color: hero.color ?? "",
    faceImage: hero.faceImage ?? "",
    bodyImage: hero.bodyImage ?? "",
    custom: false,
  };
}

function fromHeroDocument(id: string, data: Record<string, unknown>): HeroDefinition {
  const hero = data as unknown as HeroDefinition;
  return {
    ...hero,
    id,
    stats: normalizeHeroStats(hero.stats ?? HEROES[id]?.stats ?? {
      kickPower: 40, ballControl: 40, rodSpeed: 40, defense: 40, goalkeeping: 40,
    }),
    color: hero.color || HEROES[id]?.color,
    faceImage: hero.faceImage || undefined,
    bodyImage: hero.bodyImage || undefined,
    custom: false,
  };
}

function seedHeroes(): HeroDefinition[] {
  return Object.values(HEROES).map((hero) => ({ ...hero, custom: false }));
}

function defaultProfile(uid: string, displayName: string): PlayerProfile {
  const heroIds = Object.keys(HEROES);
  return {
    uid,
    displayName,
    unlockedHeroes: heroIds,
    selectedHeroId: HEROES.paulo ? "paulo" : heroIds[0] ?? "paulo",
    mmr: 1000,
    customHeroes: [],
  };
}

async function ensureUserProfile(user: User, displayName?: string): Promise<PlayerProfile> {
  const ref = doc(getDb(), "users", user.uid);
  const snap = await getDoc(ref);
  const fallbackName = displayName || user.displayName || `Jogador-${user.uid.slice(0, 5)}`;
  if (!snap.exists()) {
    const profile = defaultProfile(user.uid, fallbackName);
    await setDoc(ref, {
      ...profile,
      createdAt: serverTimestamp(),
      lastSeenAt: serverTimestamp(),
    });
    return profile;
  }

  await updateDoc(ref, { lastSeenAt: serverTimestamp() });
  const data = snap.data() as Partial<PlayerProfile>;
  return {
    uid: user.uid,
    displayName: data.displayName || fallbackName,
    unlockedHeroes: data.unlockedHeroes ?? defaultProfile(user.uid, fallbackName).unlockedHeroes,
    selectedHeroId: data.selectedHeroId ?? "paulo",
    mmr: typeof data.mmr === "number" ? data.mmr : 1000,
    customHeroes: Array.isArray(data.customHeroes) ? data.customHeroes : [],
  };
}

/** Traduz os erros comuns do Auth para mensagens amigáveis. */
export function mapAuthError(error: unknown): string {
  const code = (error as { code?: string })?.code ?? "";
  if (code.includes("invalid-email")) return "E-mail inválido.";
  if (code.includes("missing-password")) return "Informe uma senha.";
  if (code.includes("weak-password")) return "A senha precisa ter pelo menos 6 caracteres.";
  if (code.includes("email-already-in-use")) return "Este e-mail já está cadastrado. Faça login.";
  if (code.includes("wrong-password") || code.includes("invalid-credential")) return "E-mail ou senha incorretos.";
  if (code.includes("user-not-found")) return "Conta não encontrada. Crie uma conta primeiro.";
  if (code.includes("popup-closed-by-user")) return "Login cancelado.";
  if (code.includes("operation-not-allowed")) return "Provedor de login desativado no Firebase Console.";
  if (code.includes("network-request-failed")) return "Sem conexão com o Firebase.";
  return error instanceof Error ? error.message : "Não foi possível entrar.";
}

export class FirebaseWebService implements FirebaseService {
  async signIn(): Promise<PlayerProfile> {
    const authProvider = import.meta.env.VITE_FIREBASE_AUTH_PROVIDER ?? "anonymous";
    const firebaseAuth = getFirebaseAuth();
    const credential =
      authProvider === "google"
        ? await signInWithPopup(firebaseAuth, new GoogleAuthProvider())
        : await signInAnonymously(firebaseAuth);
    return ensureUserProfile(credential.user);
  }

  async signInWithEmail(email: string, password: string): Promise<PlayerProfile> {
    const credential = await signInWithEmailAndPassword(getFirebaseAuth(), email.trim(), password);
    return ensureUserProfile(credential.user);
  }

  async signUpWithEmail(name: string, email: string, password: string): Promise<PlayerProfile> {
    const credential = await createUserWithEmailAndPassword(getFirebaseAuth(), email.trim(), password);
    if (name.trim()) await updateProfile(credential.user, { displayName: name.trim() });
    return ensureUserProfile(credential.user, name.trim());
  }

  async signInWithGoogle(): Promise<PlayerProfile> {
    const credential = await signInWithPopup(getFirebaseAuth(), new GoogleAuthProvider());
    return ensureUserProfile(credential.user);
  }

  async signInAsGuest(): Promise<PlayerProfile> {
    const credential = await signInAnonymously(getFirebaseAuth());
    return ensureUserProfile(credential.user);
  }

  async restoreSession(): Promise<PlayerProfile | null> {
    const firebaseAuth = getFirebaseAuth();
    return new Promise((resolve) => {
      let unsubscribe: (() => void) | null = null;
      unsubscribe = onAuthStateChanged(firebaseAuth, async (user) => {
        unsubscribe?.();
        if (!user) return resolve(null);
        try {
          resolve(await ensureUserProfile(user));
        } catch {
          resolve(null);
        }
      });
    });
  }

  async signOut(): Promise<void> {
    await signOut(getFirebaseAuth());
  }

  async getProfile(uid: string): Promise<PlayerProfile | null> {
    const snap = await getDoc(doc(getDb(), "users", uid));
    if (!snap.exists()) return null;
    const data = snap.data() as Partial<PlayerProfile>;
    return {
      uid,
      displayName: data.displayName || `Jogador-${uid.slice(0, 5)}`,
      unlockedHeroes: data.unlockedHeroes ?? Object.keys(HEROES),
      selectedHeroId: data.selectedHeroId ?? "paulo",
      mmr: typeof data.mmr === "number" ? data.mmr : 1000,
      customHeroes: Array.isArray(data.customHeroes) ? data.customHeroes : [],
    };
  }

  async saveProfile(profile: PlayerProfile): Promise<void> {
    await setDoc(
      doc(getDb(), "users", profile.uid),
      {
        displayName: profile.displayName,
        selectedHeroId: profile.selectedHeroId,
        unlockedHeroes: profile.unlockedHeroes,
        mmr: profile.mmr,
        customHeroes: profile.customHeroes,
        lastSeenAt: serverTimestamp(),
      },
      { merge: true },
    );
  }

  async saveSelectedHero(uid: string, heroId: string): Promise<void> {
    await setDoc(
      doc(getDb(), "users", uid),
      { selectedHeroId: heroId, lastSeenAt: serverTimestamp() },
      { merge: true },
    );
    await setDoc(
      doc(getDb(), "loadouts", uid),
      { heroId, updatedAt: serverTimestamp() },
      { merge: true },
    );
  }

  async listHeroes(): Promise<HeroDefinition[]> {
    const snap = await getDocs(collection(getDb(), "heroes"));
    if (snap.empty) {
      // Seed inicial: grava o elenco oficial na coleção global uma única vez.
      await Promise.all(seedHeroes().map((hero) =>
        setDoc(doc(getDb(), "heroes", hero.id), {
          ...toHeroDocument(hero), createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        }),
      ));
      return seedHeroes();
    }
    return snap.docs
      .map((docSnap) => fromHeroDocument(docSnap.id, docSnap.data() as Record<string, unknown>))
      .sort((a, b) => Object.keys(HEROES).indexOf(a.id) - Object.keys(HEROES).indexOf(b.id));
  }

  async saveHero(hero: HeroDefinition): Promise<void> {
    await setDoc(
      doc(getDb(), "heroes", hero.id),
      { ...toHeroDocument(hero), updatedAt: serverTimestamp() },
      { merge: true },
    );
  }
}

/**
 * Matchmaking simples SEM Cloud Functions (MVP).
 * Limitações: cliente decide pareamento; para produção, usar backend confiável.
 */
export async function enqueueMatchmaking(ticket: Omit<MatchmakingTicket, "status" | "matchId">): Promise<void> {
  await setDoc(doc(getDb(), "matchmakingQueue", ticket.uid), {
    ...ticket,
    status: "queued",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function cancelMatchmaking(uid: string): Promise<void> {
  await deleteDoc(doc(getDb(), "matchmakingQueue", uid));
}

export async function tryFindMatch(uid: string, mmr: number, mmrWindow = 200): Promise<string | null> {
  const dbRef = getDb();
  const q = query(
    collection(dbRef, "matchmakingQueue"),
    where("status", "==", "queued"),
    limit(10),
  );
  const candidates = await getDocs(q);
  const opponent = candidates.docs
    .map((d) => ({ id: d.id, ...(d.data() as MatchmakingTicket) }))
    .find((c) => c.uid !== uid && Math.abs(c.mmr - mmr) <= mmrWindow);

  if (!opponent) return null;

  const matchId = `match_${uid.slice(0, 6)}_${opponent.uid.slice(0, 6)}_${Date.now()}`;
  await runTransaction(dbRef, async (tx) => {
    const myRef = doc(dbRef, "matchmakingQueue", uid);
    const opRef = doc(dbRef, "matchmakingQueue", opponent.uid);
    const matchRef = doc(dbRef, "matches", matchId);
    const [mySnap, opSnap] = await Promise.all([tx.get(myRef), tx.get(opRef)]);
    if (!mySnap.exists() || !opSnap.exists()) throw new Error("Fila mudou; tente novamente.");
    if (mySnap.data().status !== "queued" || opSnap.data().status !== "queued") {
      throw new Error("Oponente já não está disponível.");
    }

    const myTicket = mySnap.data() as MatchmakingTicket;
    const opTicket = opSnap.data() as MatchmakingTicket;
    tx.set(matchRef, {
      status: "waiting",
      mode: "1v1",
      createdAt: serverTimestamp(),
      players: [
        {
          uid,
          mmr,
          heroId: myTicket.heroId,
          peerId: myTicket.peerId ?? null,
          displayName: myTicket.displayName ?? null,
        },
        {
          uid: opponent.uid,
          mmr: opponent.mmr,
          heroId: opTicket.heroId,
          peerId: opTicket.peerId ?? null,
          displayName: opTicket.displayName ?? null,
        },
      ],
    });
    tx.update(myRef, { status: "matched", matchId, updatedAt: serverTimestamp() });
    tx.update(opRef, { status: "matched", matchId, updatedAt: serverTimestamp() });
  });

  return matchId;
}

/** Lê o documento da partida criada pelo matchmaking para descobrir o par. */
export async function getMatch(matchId: string): Promise<MatchRecord | null> {
  const snap = await getDoc(doc(getDb(), "matches", matchId));
  return snap.exists() ? (snap.data() as MatchRecord) : null;
}

const LOCAL_KEY = "pimbocas.localProfile.v1";
const HEROES_KEY = "pimbocas.heroes.v1";

function readLocalHeroes(): HeroDefinition[] {
  try {
    const raw = localStorage.getItem(HEROES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as HeroDefinition[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((hero) => fromHeroDocument(hero.id, hero as unknown as Record<string, unknown>));
      }
    }
  } catch {
    // localStorage indisponível: usa o seed.
  }
  const seeded = seedHeroes();
  try { localStorage.setItem(HEROES_KEY, JSON.stringify(seeded)); } catch { /* noop */ }
  return seeded;
}

function readLocalProfile(): PlayerProfile {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PlayerProfile>;
      if (parsed.uid) return { ...defaultProfile("local", "Jogador Local"), ...parsed, customHeroes: parsed.customHeroes ?? [] };
    }
  } catch {
    // localStorage indisponível: usa perfil em memória.
  }
  return defaultProfile("local", "Jogador Local");
}

/** Funciona sem Firebase: útil para testar telas e jogo localmente. */
export class FirebaseServiceStub implements FirebaseService {
  async signIn(): Promise<PlayerProfile> { return readLocalProfile(); }
  async signInWithEmail(): Promise<PlayerProfile> { return readLocalProfile(); }
  async signUpWithEmail(name: string): Promise<PlayerProfile> {
    const profile = { ...readLocalProfile(), displayName: name || "Jogador Local" };
    this.saveProfile(profile);
    return profile;
  }
  async signInWithGoogle(): Promise<PlayerProfile> { return readLocalProfile(); }
  async signInAsGuest(): Promise<PlayerProfile> { return readLocalProfile(); }
  async restoreSession(): Promise<PlayerProfile | null> {
    try {
      return localStorage.getItem(LOCAL_KEY) ? readLocalProfile() : null;
    } catch {
      return null;
    }
  }
  async signOut(): Promise<void> {
    try { localStorage.removeItem(LOCAL_KEY); } catch { /* noop */ }
  }
  async getProfile(): Promise<PlayerProfile | null> { return readLocalProfile(); }
  async saveProfile(profile: PlayerProfile): Promise<void> {
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(profile)); } catch { /* noop */ }
  }
  async saveSelectedHero(_uid: string, heroId: string): Promise<void> {
    const profile = readLocalProfile();
    profile.selectedHeroId = heroId;
    this.saveProfile(profile);
  }
  async listHeroes(): Promise<HeroDefinition[]> { return readLocalHeroes(); }
  async saveHero(hero: HeroDefinition): Promise<void> {
    const heroes = readLocalHeroes();
    const next = heroes.some((h) => h.id === hero.id)
      ? heroes.map((h) => h.id === hero.id ? hero : h)
      : [...heroes, hero];
    try { localStorage.setItem(HEROES_KEY, JSON.stringify(next)); } catch { /* noop */ }
  }
}

export function createFirebaseService(): FirebaseService {
  return hasFirebaseConfig() ? new FirebaseWebService() : new FirebaseServiceStub();
}
