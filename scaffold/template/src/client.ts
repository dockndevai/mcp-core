/**
 * Thin domain client for __SERVER_NAME__.
 *
 * Replace this in-memory stub with a real wrapper over your backend SDK / REST API. Keep it a thin
 * data layer: no policy decisions here — those belong to the mcp-core SecurityPolicy, enforced in the
 * tool handlers before any call reaches this client.
 */
export interface __RESOURCE___Record {
  name: string;
  value: string;
}

export class __SERVER_PASCAL__Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = "__SERVER_PASCAL__Error";
  }
}

export class Client {
  private readonly store = new Map<string, string>([["example", "hello"]]);

  list(): __RESOURCE___Record[] {
    return [...this.store.entries()].map(([name, value]) => ({ name, value }));
  }

  get(name: string): __RESOURCE___Record {
    const value = this.store.get(name);
    if (value === undefined) throw new __SERVER_PASCAL__Error(`__RESOURCE__ '${name}' not found`);
    return { name, value };
  }

  set(name: string, value: string): void {
    this.store.set(name, value);
  }

  delete(name: string): void {
    if (!this.store.delete(name)) throw new __SERVER_PASCAL__Error(`__RESOURCE__ '${name}' not found`);
  }
}
