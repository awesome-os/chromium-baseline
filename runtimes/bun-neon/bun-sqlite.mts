export interface SQLiteRunResult {
  changes: number | bigint;
  lastInsertRowid: number | bigint;
}

export interface Statement<TRow = Record<string, unknown>> {
  all(...params: unknown[]): TRow[];
  get(...params: unknown[]): TRow | null;
  run(...params: unknown[]): SQLiteRunResult;
  finalize(): void;
}

export interface DatabaseOptions {
  readonly?: boolean;
  create?: boolean;
  readwrite?: boolean;
}

interface NodeSqliteStatement {
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
}

interface NodeSqliteDatabaseSync {
  exec(sql: string): void;
  prepare(sql: string): NodeSqliteStatement;
  close(): void;
}

interface NodeSqliteModule {
  DatabaseSync: new (location: string, options?: { readOnly?: boolean }) => NodeSqliteDatabaseSync;
}

function loadNodeSqlite(): NodeSqliteModule | null {
  try {
    const getBuiltin = (process as unknown as { getBuiltinModule?: (id: string) => unknown })
      .getBuiltinModule;
    if (typeof getBuiltin === 'function') {
      const mod = getBuiltin('node:sqlite') as NodeSqliteModule | undefined;
      if (mod && typeof mod.DatabaseSync === 'function') {
        return mod;
      }
    }
  } catch {
    // Fall back to in-memory SQL subset
  }
  return null;
}

// --- Tiny in-memory SQL subset fallback when node:sqlite is unavailable ---

interface FallbackTable {
  columns: string[];
  rows: Record<string, unknown>[];
  nextRowId: number;
}

class FallbackEngine {
  private readonly tables = new Map<string, FallbackTable>();
  private snapshot: Map<string, FallbackTable> | null = null;
  private closed = false;

  private ensureOpen(): void {
    if (this.closed) {
      throw new Error('Database is closed');
    }
  }

  close(): void {
    this.closed = true;
    this.tables.clear();
  }

  exec(sql: string): void {
    this.ensureOpen();
    const statements = sql
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const stmt of statements) {
      this.executeSingle(stmt, []);
    }
  }

  private cloneTables(): Map<string, FallbackTable> {
    const copy = new Map<string, FallbackTable>();
    for (const [k, v] of this.tables) {
      copy.set(k, {
        columns: [...v.columns],
        rows: v.rows.map((r) => ({ ...r })),
        nextRowId: v.nextRowId,
      });
    }
    return copy;
  }

  private parseLiteral(token: string, params: unknown[], paramIdx: { i: number }): unknown {
    const trimmed = token.trim();
    if (trimmed === '?') {
      return params[paramIdx.i++];
    }
    if (trimmed.toUpperCase() === 'NULL') return null;
    if (
      (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
      (trimmed.startsWith('"') && trimmed.endsWith('"'))
    ) {
      return trimmed.slice(1, -1).replace(/''/g, "'");
    }
    const num = Number(trimmed);
    if (!Number.isNaN(num) && trimmed !== '') return num;
    return trimmed;
  }

  private splitCsv(input: string): string[] {
    const parts: string[] = [];
    let current = '';
    let inQuote: string | null = null;
    let depth = 0;
    for (let i = 0; i < input.length; i++) {
      const ch = input[i]!;
      if (inQuote) {
        current += ch;
        if (ch === inQuote) inQuote = null;
      } else if (ch === "'" || ch === '"') {
        inQuote = ch;
        current += ch;
      } else if (ch === '(') {
        depth++;
        current += ch;
      } else if (ch === ')') {
        depth--;
        current += ch;
      } else if (ch === ',' && depth === 0) {
        parts.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    if (current.trim()) parts.push(current.trim());
    return parts;
  }

  private matchWhere(
    row: Record<string, unknown>,
    whereClause: string | undefined,
    params: unknown[],
    paramIdx: { i: number },
  ): boolean {
    if (!whereClause) return true;
    const eqMatch = whereClause.match(/^([A-Za-z_]\w*)\s*=\s*(.+)$/);
    if (eqMatch) {
      const col = eqMatch[1]!;
      const expected = this.parseLiteral(eqMatch[2]!, params, paramIdx);
      return row[col] === expected;
    }
    return true;
  }

  executeSingle(
    sql: string,
    params: unknown[],
  ): { rows: Record<string, unknown>[]; changes: number; lastInsertRowid: number } {
    this.ensureOpen();
    const cleaned = sql.trim().replace(/;+$/, '');
    const upper = cleaned.toUpperCase();

    if (upper === 'BEGIN' || upper === 'BEGIN TRANSACTION') {
      this.snapshot = this.cloneTables();
      return { rows: [], changes: 0, lastInsertRowid: 0 };
    }
    if (upper === 'COMMIT' || upper === 'END TRANSACTION') {
      this.snapshot = null;
      return { rows: [], changes: 0, lastInsertRowid: 0 };
    }
    if (upper === 'ROLLBACK') {
      if (this.snapshot) {
        this.tables.clear();
        for (const [k, v] of this.snapshot) this.tables.set(k, v);
        this.snapshot = null;
      }
      return { rows: [], changes: 0, lastInsertRowid: 0 };
    }

    // CREATE TABLE
    const createMatch = cleaned.match(
      /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_]\w*)\s*\(([\s\S]+)\)$/i,
    );
    if (createMatch) {
      const tableName = createMatch[1]!;
      if (!this.tables.has(tableName)) {
        const colDefs = this.splitCsv(createMatch[2]!);
        const columns = colDefs.map((def) => def.trim().split(/\s+/)[0]!.replace(/["`]/g, ''));
        this.tables.set(tableName, { columns, rows: [], nextRowId: 1 });
      }
      return { rows: [], changes: 0, lastInsertRowid: 0 };
    }

    // DROP TABLE
    const dropMatch = cleaned.match(/^DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([A-Za-z_]\w*)$/i);
    if (dropMatch) {
      this.tables.delete(dropMatch[1]!);
      return { rows: [], changes: 0, lastInsertRowid: 0 };
    }

    // INSERT INTO
    const insertMatch = cleaned.match(
      /^INSERT\s+INTO\s+([A-Za-z_]\w*)\s*(?:\(([^)]+)\))?\s*VALUES\s*\(([\s\S]+)\)$/i,
    );
    if (insertMatch) {
      const table = this.tables.get(insertMatch[1]!);
      if (!table) throw new Error(`no such table: ${insertMatch[1]}`);
      const cols = insertMatch[2]
        ? this.splitCsv(insertMatch[2]).map((c) => c.replace(/["`]/g, ''))
        : table.columns;
      const valTokens = this.splitCsv(insertMatch[3]!);
      const paramIdx = { i: 0 };
      const row: Record<string, unknown> = {};
      for (const col of table.columns) row[col] = null;
      cols.forEach((col, idx) => {
        row[col] = this.parseLiteral(valTokens[idx] ?? 'NULL', params, paramIdx);
      });
      const rowid = table.nextRowId++;
      if (table.columns.includes('id') && row.id === null) {
        row.id = rowid;
      }
      table.rows.push(row);
      return { rows: [], changes: 1, lastInsertRowid: rowid };
    }

    // SELECT
    const selectMatch = cleaned.match(
      /^SELECT\s+([\s\S]+?)\s+FROM\s+([A-Za-z_]\w*)(?:\s+WHERE\s+([\s\S]+?))?(?:\s+ORDER\s+BY\s+([A-Za-z_]\w*)(?:\s+(ASC|DESC))?)?(?:\s+LIMIT\s+(\d+))?$/i,
    );
    if (selectMatch) {
      const selectCols = selectMatch[1]!.trim();
      const table = this.tables.get(selectMatch[2]!);
      if (!table) throw new Error(`no such table: ${selectMatch[2]}`);
      const whereClause = selectMatch[3]?.trim();
      const orderCol = selectMatch[4];
      const orderDir = (selectMatch[5] ?? 'ASC').toUpperCase();
      const limit = selectMatch[6] ? Number(selectMatch[6]) : undefined;

      let matched = table.rows.filter((r) =>
        this.matchWhere(r, whereClause, params, { i: 0 }),
      );

      if (orderCol) {
        matched = [...matched].sort((a, b) => {
          const av = a[orderCol] as number | string;
          const bv = b[orderCol] as number | string;
          if (av < bv) return orderDir === 'DESC' ? 1 : -1;
          if (av > bv) return orderDir === 'DESC' ? -1 : 1;
          return 0;
        });
      }
      if (limit !== undefined) {
        matched = matched.slice(0, limit);
      }

      if (selectCols === '*') {
        return { rows: matched.map((r) => ({ ...r })), changes: 0, lastInsertRowid: 0 };
      }
      const cols = this.splitCsv(selectCols);
      const projected = matched.map((r) => {
        const out: Record<string, unknown> = {};
        for (const col of cols) {
          out[col] = r[col];
        }
        return out;
      });
      return { rows: projected, changes: 0, lastInsertRowid: 0 };
    }

    // UPDATE
    const updateMatch = cleaned.match(
      /^UPDATE\s+([A-Za-z_]\w*)\s+SET\s+([A-Za-z_]\w*)\s*=\s*([\s\S]+?)(?:\s+WHERE\s+([\s\S]+))?$/i,
    );
    if (updateMatch) {
      const table = this.tables.get(updateMatch[1]!);
      if (!table) throw new Error(`no such table: ${updateMatch[1]}`);
      const setCol = updateMatch[2]!;
      const setValToken = updateMatch[3]!.trim();
      const whereClause = updateMatch[4]?.trim();
      let changes = 0;
      for (const row of table.rows) {
        const paramIdx = { i: 0 };
        const newVal = this.parseLiteral(setValToken, params, paramIdx);
        if (this.matchWhere(row, whereClause, params, paramIdx)) {
          row[setCol] = newVal;
          changes++;
        }
      }
      return { rows: [], changes, lastInsertRowid: 0 };
    }

    // DELETE
    const deleteMatch = cleaned.match(
      /^DELETE\s+FROM\s+([A-Za-z_]\w*)(?:\s+WHERE\s+([\s\S]+))?$/i,
    );
    if (deleteMatch) {
      const table = this.tables.get(deleteMatch[1]!);
      if (!table) throw new Error(`no such table: ${deleteMatch[1]}`);
      const whereClause = deleteMatch[2]?.trim();
      const before = table.rows.length;
      table.rows = table.rows.filter(
        (r) => !this.matchWhere(r, whereClause, params, { i: 0 }),
      );
      return { rows: [], changes: before - table.rows.length, lastInsertRowid: 0 };
    }

    throw new Error(`Unsupported fallback SQL statement: ${cleaned}`);
  }
}

function normalizeParams(params: unknown[]): unknown[] {
  if (params.length === 1 && Array.isArray(params[0])) {
    return params[0] as unknown[];
  }
  return params;
}

export class Database {
  readonly filename: string;
  private readonly nativeDb: NodeSqliteDatabaseSync | null;
  private readonly fallback: FallbackEngine | null;

  constructor(filename = ':memory:', opts: DatabaseOptions = {}) {
    this.filename = filename;
    const sqliteMod = loadNodeSqlite();
    if (sqliteMod) {
      this.nativeDb = new sqliteMod.DatabaseSync(filename, {
        readOnly: opts.readonly === true,
      });
      this.fallback = null;
    } else {
      this.nativeDb = null;
      this.fallback = new FallbackEngine();
    }
  }

  exec(sql: string): this {
    if (this.nativeDb) {
      this.nativeDb.exec(sql);
    } else {
      this.fallback!.exec(sql);
    }
    return this;
  }

  run(sql: string, ...params: unknown[]): SQLiteRunResult {
    return this.prepare(sql).run(...params);
  }

  prepare<TRow = Record<string, unknown>>(sql: string): Statement<TRow> {
    if (this.nativeDb) {
      const stmt = this.nativeDb.prepare(sql);
      return {
        all(...params: unknown[]): TRow[] {
          return stmt.all(...normalizeParams(params)) as TRow[];
        },
        get(...params: unknown[]): TRow | null {
          const row = stmt.get(...normalizeParams(params));
          return (row === undefined ? null : row) as TRow | null;
        },
        run(...params: unknown[]): SQLiteRunResult {
          const res = stmt.run(...normalizeParams(params));
          return {
            changes: res.changes,
            lastInsertRowid: res.lastInsertRowid,
          };
        },
        finalize(): void {
          // Managed by GC in node:sqlite
        },
      };
    }

    const engine = this.fallback!;
    return {
      all(...params: unknown[]): TRow[] {
        return engine.executeSingle(sql, normalizeParams(params)).rows as TRow[];
      },
      get(...params: unknown[]): TRow | null {
        const rows = engine.executeSingle(sql, normalizeParams(params)).rows;
        return (rows[0] ?? null) as TRow | null;
      },
      run(...params: unknown[]): SQLiteRunResult {
        const res = engine.executeSingle(sql, normalizeParams(params));
        return { changes: res.changes, lastInsertRowid: res.lastInsertRowid };
      },
      finalize(): void {
        // No-op for fallback
      },
    };
  }

  query<TRow = Record<string, unknown>>(sql: string): Statement<TRow> {
    return this.prepare<TRow>(sql);
  }

  transaction<TArgs extends unknown[], TResult>(
    fn: (...args: TArgs) => TResult,
  ): (...args: TArgs) => TResult {
    return (...args: TArgs): TResult => {
      this.exec('BEGIN');
      try {
        const result = fn(...args);
        this.exec('COMMIT');
        return result;
      } catch (err) {
        try {
          this.exec('ROLLBACK');
        } catch {
          // Ignore rollback error
        }
        throw err;
      }
    };
  }

  close(): void {
    if (this.nativeDb) {
      this.nativeDb.close();
    } else {
      this.fallback!.close();
    }
  }
}

export default Database;
