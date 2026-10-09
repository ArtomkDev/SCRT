import { AggregateField, FieldValue, type Firestore } from 'firebase-admin/firestore';

type Row = Record<string, unknown>;
type Ref = { path: string; id: string; get: () => Promise<Snapshot>; set: (data: Row, options?: { merge?: boolean }) => Promise<void>; collection: (name: string) => { doc: (id?: string) => Ref } };
type Snapshot = { id: string; ref: Ref; exists: boolean; data: () => Row | undefined; get: (key: string) => unknown };
type QueryFilter = { field: string; operator: string; value: unknown };
/** Test double models atomic commit, transforms, ordering and bounded queries. */
export function activityTestStore(missingIndexes = false) {
  const records = new Map<string, Row>();
  const queries: Array<{ collection: string; limit: number; filters: QueryFilter[] }> = [];
  const batches: number[] = [];
  const field = (row: Row | undefined, key: string): unknown => key.split('.').reduce<unknown>((value, part) => value && typeof value === 'object' ? (value as Row)[part] : undefined, row);
  const snapshot = (path: string): Snapshot => {
    const value = records.get(path);
    return { id: path.split('/').at(-1)!, ref: ref(path), exists: value !== undefined, data: () => value ? structuredClone(value) : undefined, get: (key) => field(value, key) };
  };
  const write = (path: string, data: Row, merge = false) => {
    const current = merge ? { ...records.get(path) } : {};
    for (const [key, value] of Object.entries(data)) {
      if (value instanceof FieldValue) {
        if ('operand' in value && typeof value.operand === 'number') current[key] = Number(current[key] ?? 0) + value.operand;
        else current[key] = Date.now();
      } else current[key] = structuredClone(value);
    }
    records.set(path, current);
  };
  const ref = (path: string): Ref => ({ path, id: path.split('/').at(-1)!, get: async () => snapshot(path), set: async (data, options) => { write(path, data, options?.merge); }, collection: (name) => new QueryStore(`${path}/${name}`) });
  class QueryStore {
    private filters: Array<(row: Row) => boolean> = [];
    private filterFields = new Set<string>();
    private queryFilters: QueryFilter[] = [];
    private order: Array<{ field: string; direction: string }> = [];
    private count = Infinity;
    private cursor: unknown[] | undefined;
    constructor(readonly path: string) {}
    doc(id = String(Math.random())) { return ref(`${this.path}/${id}`); }
    private copy() { const next = new QueryStore(this.path); next.filters = [...this.filters]; next.filterFields = new Set(this.filterFields); next.queryFilters = [...this.queryFilters]; next.order = [...this.order]; next.count = this.count; next.cursor = this.cursor; return next; }
    where(field: string, operator: string, value: unknown) {
      const next = this.copy();
      next.filterFields.add(field);
      next.queryFilters.push({ field, operator, value });
      next.filters.push((row) => {
        const actual = field.split('.').reduce<unknown>((value, part) => value && typeof value === 'object' ? (value as Row)[part] : undefined, row);
        if (operator === '==') return actual === value;
        if (operator === 'in') return Array.isArray(value) && value.includes(actual);
        if (operator === 'array-contains') return Array.isArray(actual) && actual.includes(value);
        if (operator === '>=') return String(actual) >= String(value);
        if (operator === '<=') return String(actual) <= String(value);
        if (operator === '<') return String(actual) < String(value);
        return false;
      });
      return next;
    }
    orderBy(field: unknown, direction = 'asc') { const next = this.copy(); next.order.push({ field: typeof field === 'string' ? field : '__name__', direction }); return next; }
    limit(count: number) { const next = this.copy(); next.count = count; return next; }
    startAfter(...cursor: unknown[]) { const next = this.copy(); next.cursor = cursor; return next; }
    aggregate(fields: Record<string, AggregateField<number>>) {
      return { get: async () => {
        const { docs } = await this.get();
        const result: Record<string, number> = {};
        for (const [alias, aggregate] of Object.entries(fields)) {
          if (aggregate.isEqual(AggregateField.count())) { result[alias] = docs.length; continue; }
          let sum = 0;
          for (const doc of docs) for (const [field, value] of Object.entries(doc.data() ?? {})) {
            if (typeof value === 'number' && aggregate.isEqual(AggregateField.sum(field))) sum += value;
          }
          result[alias] = sum;
        }
        return { data: () => result };
      } };
    }
    async get() {
      queries.push({ collection: this.path, limit: this.count, filters: [...this.queryFilters] });
      // Equality filters can merge automatic single-field indexes; ranges and extra sorts cannot.
      const compoundRange = this.filterFields.size > 1 && this.queryFilters.some(({ operator }) => !['==', 'in'].includes(operator));
      const extraSort = this.order.some(({ field }) => field !== '__name__' && this.filterFields.size > 0 && !this.filterFields.has(field));
      if (missingIndexes && (compoundRange || extraSort)) throw Object.assign(new Error('The query requires an index'), { code: 9 });
      let rows = [...records].filter(([path]) => path.startsWith(`${this.path}/`) && path.split('/').length === this.path.split('/').length + 1).map(([path, row]) => ({ path, row, id: path.split('/').at(-1)! })).filter(({ row }) => this.filters.every((filter) => filter(row)));
      rows = rows.filter(({ row }) => this.order.every(({ field }) => field === '__name__' || row[field] !== undefined));
      rows.sort((a, b) => {
        for (const { field, direction } of this.order) {
          const x = field === '__name__' ? a.id : a.row[field]; const y = field === '__name__' ? b.id : b.row[field];
          const comparison = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
          if (comparison) return direction === 'desc' ? -comparison : comparison;
        }
        return this.order[0]?.direction === 'desc' ? b.id.localeCompare(a.id) : a.id.localeCompare(b.id);
      });
      if (this.cursor) rows = rows.filter(({ row, id }) => {
        for (let index = 0; index < this.cursor!.length; index++) {
          const order = this.order[index] ?? { field: '__name__', direction: 'asc' };
          const actual = order.field === '__name__' ? id : row[order.field]; const cursor = this.cursor![index];
          const comparison = typeof actual === 'number' && typeof cursor === 'number' ? actual - cursor : String(actual).localeCompare(String(cursor));
          if (comparison) return order.direction === 'desc' ? comparison < 0 : comparison > 0;
        }
        return false;
      });
      const docs = rows.slice(0, this.count).map(({ path }) => snapshot(path));
      return { docs, size: docs.length, empty: docs.length === 0 };
    }
  }
  const db = {
    collection: (name: string) => new QueryStore(name),
    getAll: async (...refs: Ref[]) => { batches.push(refs.length); return refs.map((value) => snapshot(value.path)); },
    runTransaction: async <T>(work: (tx: { get: (ref: Ref) => Promise<Snapshot>; getAll: (...refs: Ref[]) => Promise<Snapshot[]>; set: (ref: Ref, row: Row, options?: { merge?: boolean }) => void; create: (ref: Ref, row: Row) => void; delete: (ref: Ref) => void }) => Promise<T>) => {
      const writes: Array<() => void> = [];
      const result = await work({ get: async (ref) => snapshot(ref.path), getAll: async (...refs) => refs.map((ref) => snapshot(ref.path)), set: (ref, row, options) => { writes.push(() => write(ref.path, row, options?.merge)); }, create: (ref, row) => { writes.push(() => write(ref.path, row)); }, delete: (ref) => { writes.push(() => { records.delete(ref.path); }); } });
      writes.forEach((commit) => commit());
      return result;
    },
  };
  return { db: db as unknown as Firestore, records, queries, batches };
}
