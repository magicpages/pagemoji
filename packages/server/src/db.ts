import Database from 'better-sqlite3';

/** When a widget last loaded counts on a host. */
export interface Sighting {
  /** ISO 8601. */
  lastSeenAt: string;
  /** A path the widget asked for, or null when it asked only for page IDs. */
  lastSeenPath: string | null;
}

/**
 * Counts per page and emoji, and per host when a widget was last seen on it.
 * Nothing in here relates to a reader.
 */
export interface Store {
  /** `{ [key]: { [emoji]: count } }`, with every requested key present. */
  counts(
    host: string,
    keys: readonly string[],
    emojis: readonly string[],
  ): Record<string, Record<string, number>>;
  /** Adds `delta` (never going below zero) and returns every count on the page. */
  change(host: string, key: string, emoji: string, delta: 1 | -1): Record<string, number>;
  /** Every count on the page. */
  page(host: string, key: string): Record<string, number>;
  /** Records that a widget loaded counts on the host. */
  see(host: string, path: string | null, at: Date): void;
  /** When a widget was last seen on the host, if ever. */
  sighting(host: string): Sighting | undefined;
  ping(): void;
  close(): void;
}

interface Row {
  key: string;
  emoji: string;
  count: number;
}

export function openStore(path: string): Store {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS counts (
      host  TEXT NOT NULL,
      key   TEXT NOT NULL,
      emoji TEXT NOT NULL,
      count INTEGER NOT NULL,
      PRIMARY KEY (host, key, emoji)
    ) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS hosts (
      host           TEXT PRIMARY KEY,
      last_seen_at   TEXT NOT NULL,
      last_seen_path TEXT
    ) WITHOUT ROWID
  `);

  const add = db.prepare<[string, string, string]>(`
    INSERT INTO counts (host, key, emoji, count) VALUES (?, ?, ?, 1)
    ON CONFLICT (host, key, emoji) DO UPDATE SET count = count + 1
  `);
  const remove = db.prepare<[string, string, string]>(`
    UPDATE counts SET count = count - 1 WHERE host = ? AND key = ? AND emoji = ? AND count > 0
  `);
  const page = db.prepare<[string, string], Row>(
    'SELECT key, emoji, count FROM counts WHERE host = ? AND key = ? AND count > 0',
  );
  const see = db.prepare<[string, string, string | null]>(`
    INSERT INTO hosts (host, last_seen_at, last_seen_path) VALUES (?, ?, ?)
    ON CONFLICT (host) DO UPDATE
      SET last_seen_at = excluded.last_seen_at, last_seen_path = excluded.last_seen_path
  `);
  const sighting = db.prepare<[string], Sighting>(
    'SELECT last_seen_at AS lastSeenAt, last_seen_path AS lastSeenPath FROM hosts WHERE host = ?',
  );
  const ping = db.prepare('SELECT 1');

  const pageCounts = (host: string, key: string): Record<string, number> =>
    Object.fromEntries(page.all(host, key).map((row) => [row.emoji, row.count]));

  return {
    counts(host, keys, emojis) {
      const rows = db
        .prepare<unknown[], Row>(
          `SELECT key, emoji, count FROM counts
           WHERE host = ? AND count > 0
             AND key IN (${keys.map(() => '?').join(',')})
             AND emoji IN (${emojis.map(() => '?').join(',')})`,
        )
        .all(host, ...keys, ...emojis);
      const result: Record<string, Record<string, number>> = {};
      for (const key of keys) result[key] = {};
      for (const row of rows) {
        const forKey = result[row.key];
        if (forKey) forKey[row.emoji] = row.count;
      }
      return result;
    },
    change: db.transaction((host: string, key: string, emoji: string, delta: 1 | -1) => {
      (delta === 1 ? add : remove).run(host, key, emoji);
      return pageCounts(host, key);
    }),
    page: pageCounts,
    see(host, path, at) {
      see.run(host, at.toISOString(), path);
    },
    sighting(host) {
      return sighting.get(host);
    },
    ping() {
      ping.get();
    },
    close() {
      db.close();
    },
  };
}
