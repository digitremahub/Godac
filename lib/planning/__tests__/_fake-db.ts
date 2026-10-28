/**
 * Mini base en mémoire pour tester les routes et fonctions serveur sans
 * Supabase : le sous-ensemble de l'API de requête que le planning utilise
 * (select / insert / upsert / update / delete, eq, neq, in, is, not, gte, lt,
 * lte, order, range, limit, single, maybeSingle). Une table absente répond
 * comme PostgREST pour une migration non appliquée (42P01).
 */
type Ligne = Record<string, any>;
interface Resultat {
  data: any;
  error: { code?: string; message: string } | null;
}

const UNIQUES: Record<string, string[]> = {
  planning_semaines_auto: ["organization_id", "service_id", "semaine_debut"],
  planning_entries: ["organization_id", "service_id", "tour_number", "start_at"],
  planning_validations: ["organization_id", "service_id", "week_start"],
  alerts: ["organization_id", "cle_dedoublonnage"],
};

/** Valeurs par défaut des colonnes (comme la base). */
const DEFAUTS: Record<string, () => Ligne> = {
  planning_semaines_auto: () => ({ genere_par: "auto", genere_at: new Date().toISOString(), modifie_at: null, confirme_at: null, confirme_par: null, publie_at: null, publie_mode: null, rappel_envoye_at: null, resume: {} }),
  alerts: () => ({ status: "open" }),
};

const estInstant = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v);
const valeur = (v: unknown) => (estInstant(v) ? Date.parse(v as string) : v);
const comparer = (a: unknown, b: unknown) => {
  const x = valeur(a) as any;
  const y = valeur(b) as any;
  return x < y ? -1 : x > y ? 1 : 0;
};
const memeCle = (table: string, a: Ligne, b: Ligne) => {
  const cles = UNIQUES[table];
  if (!cles) return false;
  if (table === "alerts" && (a.cle_dedoublonnage == null || b.cle_dedoublonnage == null)) return false;
  return cles.every((c) => comparer(a[c], b[c]) === 0);
};

let compteur = 0;

export class FakeDb {
  tables: Record<string, Ligne[]>;
  constructor(tables: Record<string, Ligne[]>) {
    this.tables = tables;
  }
  from(nom: string) {
    return new Requete(this, nom);
  }
  ligne(nom: string) {
    return this.tables[nom] ?? [];
  }
}

class Requete implements PromiseLike<Resultat> {
  private filtres: ((l: Ligne) => boolean)[] = [];
  private op: "select" | "insert" | "upsert" | "update" | "delete" = "select";
  private charge: Ligne[] | Ligne | null = null;
  private options: { ignoreDuplicates?: boolean } = {};
  private retourne = false;
  private mode: "liste" | "un" | "peutEtre" = "liste";
  private debut = 0;
  private fin = Infinity;
  constructor(
    private db: FakeDb,
    private nom: string,
  ) {}

  select(_colonnes?: string) {
    if (this.op === "select") this.retourne = true;
    else this.retourne = true;
    return this;
  }
  eq(c: string, v: unknown) {
    this.filtres.push((l) => comparer(l[c], v) === 0);
    return this;
  }
  neq(c: string, v: unknown) {
    this.filtres.push((l) => comparer(l[c], v) !== 0);
    return this;
  }
  in(c: string, vs: readonly unknown[]) {
    this.filtres.push((l) => vs.some((v) => comparer(l[c], v) === 0));
    return this;
  }
  is(c: string, v: null) {
    this.filtres.push((l) => (v === null ? l[c] == null : l[c] === v));
    return this;
  }
  not(c: string, _op: string, _v: null) {
    this.filtres.push((l) => l[c] != null);
    return this;
  }
  gt(c: string, v: unknown) {
    this.filtres.push((l) => l[c] != null && comparer(l[c], v) > 0);
    return this;
  }
  gte(c: string, v: unknown) {
    this.filtres.push((l) => l[c] != null && comparer(l[c], v) >= 0);
    return this;
  }
  lt(c: string, v: unknown) {
    this.filtres.push((l) => l[c] != null && comparer(l[c], v) < 0);
    return this;
  }
  lte(c: string, v: unknown) {
    this.filtres.push((l) => l[c] != null && comparer(l[c], v) <= 0);
    return this;
  }
  order(_c: string, _o?: unknown) {
    return this;
  }
  limit(_n: number) {
    return this;
  }
  range(a: number, b: number) {
    this.debut = a;
    this.fin = b;
    return this;
  }
  single() {
    this.mode = "un";
    return this;
  }
  maybeSingle() {
    this.mode = "peutEtre";
    return this;
  }
  insert(l: Ligne | Ligne[]) {
    this.op = "insert";
    this.charge = l;
    return this;
  }
  upsert(l: Ligne | Ligne[], options: { ignoreDuplicates?: boolean } = {}) {
    this.op = "upsert";
    this.charge = l;
    this.options = options;
    return this;
  }
  update(l: Ligne) {
    this.op = "update";
    this.charge = l;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }

  private executer(): Resultat {
    const table = this.db.tables[this.nom];
    if (!table) return { data: null, error: { code: "42P01", message: `relation "${this.nom}" does not exist` } };
    let touchees: Ligne[] = [];
    if (this.op === "insert" || this.op === "upsert") {
      const lignes = (Array.isArray(this.charge) ? this.charge : [this.charge!]) as Ligne[];
      for (const l of lignes) {
        const existante = table.find((e) => memeCle(this.nom, e, l));
        if (existante) {
          if (this.op === "insert") return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
          if (!this.options.ignoreDuplicates) {
            Object.assign(existante, l);
            touchees.push(existante);
          }
          continue;
        }
        const nouvelle = { id: `id-${++compteur}`, ...(DEFAUTS[this.nom]?.() ?? {}), ...l };
        table.push(nouvelle);
        touchees.push(nouvelle);
      }
    } else if (this.op === "update") {
      touchees = table.filter((l) => this.filtres.every((f) => f(l)));
      for (const l of touchees) Object.assign(l, this.charge);
    } else if (this.op === "delete") {
      touchees = table.filter((l) => this.filtres.every((f) => f(l)));
      for (const l of touchees) table.splice(table.indexOf(l), 1);
    } else {
      touchees = table.filter((l) => this.filtres.every((f) => f(l))).slice(this.debut, this.fin === Infinity ? undefined : this.fin + 1);
    }
    if (this.op !== "select" && !this.retourne) return { data: null, error: null };
    const copies = touchees.map((l) => ({ ...l }));
    if (this.mode === "liste") return { data: copies, error: null };
    if (this.mode === "un") return copies.length === 1 ? { data: copies[0], error: null } : { data: null, error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" } };
    return { data: copies[0] ?? null, error: null };
  }

  then<A = Resultat, B = never>(onfulfilled?: ((v: Resultat) => A | PromiseLike<A>) | null, onrejected?: ((r: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return Promise.resolve(this.executer()).then(onfulfilled, onrejected);
  }
}

export const fakeDb = (tables: Record<string, Ligne[]>) => new FakeDb(tables);
