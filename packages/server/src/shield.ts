import { createHmac, randomBytes } from 'node:crypto';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export interface ShieldOptions {
  now?: () => number;
  requestsPerMinute?: number;
}

/**
 * Everything the server remembers about who sent a request, in memory only.
 * Clients are known by an HMAC of their IP address under a salt that is
 * replaced every hour, together with every entry made under it, so no entry
 * can be traced back to an address afterwards.
 */
export class Shield {
  readonly #now: () => number;
  readonly #limit: number;
  #hour = -1;
  #minute = -1;
  #salt = Buffer.alloc(0);
  #requests = new Map<string, number>();
  #reactions = new Set<string>();

  constructor({ now = Date.now, requestsPerMinute = 60 }: ShieldOptions = {}) {
    this.#now = now;
    this.#limit = requestsPerMinute;
  }

  #tick(): number {
    const now = this.#now();
    const hour = Math.floor(now / HOUR);
    if (hour !== this.#hour) {
      this.#hour = hour;
      this.#salt = randomBytes(32);
      this.#reactions.clear();
    }
    const minute = Math.floor(now / MINUTE);
    if (minute !== this.#minute) {
      this.#minute = minute;
      this.#requests.clear();
    }
    return now;
  }

  client(ip: string): string {
    this.#tick();
    return createHmac('sha256', this.#salt).update(ip).digest('base64url');
  }

  /** Counts a request. Returns the seconds to wait when over the limit, else 0. */
  limit(client: string): number {
    const now = this.#tick();
    const count = (this.#requests.get(client) ?? 0) + 1;
    if (count > this.#limit) return Math.ceil(((this.#minute + 1) * MINUTE - now) / 1000);
    this.#requests.set(client, count);
    return 0;
  }

  /** Records a reaction. False when this client has already given it. */
  add(client: string, reaction: string): boolean {
    this.#tick();
    const entry = `${client}\n${reaction}`;
    if (this.#reactions.has(entry)) return false;
    this.#reactions.add(entry);
    return true;
  }

  /** Forgets a reaction. False when this client never gave it. */
  remove(client: string, reaction: string): boolean {
    this.#tick();
    return this.#reactions.delete(`${client}\n${reaction}`);
  }
}
