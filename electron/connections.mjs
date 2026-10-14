import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { appVersion } from './version.mjs';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
export class Connections {
  constructor(store, runtime = {}) {
    this.store = store;
    this.clients = new Map();
    this.registry = new Map();
    this.pending = new Map();
    this.closed = false;
    this.createClient =
      runtime.createClient ?? (() => new Client({ name: 'Intelligence', version: appVersion }));
    this.createTransport =
      runtime.createTransport ??
      ((e) =>
        e.data.transport === 'http'
          ? new StreamableHTTPClientTransport(new URL(e.data.url))
          : new StdioClientTransport({
              command: e.data.command,
              args: e.data.args ?? [],
              stderr: 'ignore',
            }));
  }
  connect(id, { signal, isAllowed = () => true } = {}) {
    if (this.closed) return Promise.reject(new Error('Connections are closed'));
    if (this.pending.has(id)) return this.pending.get(id).promise;
    const e = this.store.get(id);
    if (!e || e.kind !== 'connection') return Promise.reject(new Error('Connection not found'));
    const state = { cancelled: false, client: null, promise: null };
    state.promise = (async () => {
      await this.removeClient(id);
      if (state.cancelled || this.closed) throw new Error('Connection cancelled');
      const client = (state.client = this.createClient());
      try {
        signal?.throwIfAborted();
        if (!isAllowed()) throw Error('Connection access changed');
        const options = { signal, timeout: 15000, maxTotalTimeout: 20000 };
        await client.connect(this.createTransport(e), options);
        const { tools } = await client.listTools(undefined, options);
        signal?.throwIfAborted();
        if (state.cancelled || this.closed || !isAllowed()) throw new Error('Connection cancelled');
        this.clients.set(id, client);
        for (const [i, t] of tools.entries()) {
          const name = 'mcp_' + id.replaceAll('-', '').slice(0, 12) + '_' + i;
          this.registry.set(name, {
            id,
            original: t.name,
            tool: {
              type: 'function',
              function: {
                name,
                description: `${e.title}: ${t.description ?? t.name}`,
                parameters: t.inputSchema,
              },
            },
          });
        }
        return { tools: tools.map((t) => t.name), connected: true };
      } catch (error) {
        await client.close().catch(() => {});
        throw error;
      }
    })().finally(() => {
      if (this.pending.get(id) === state) this.pending.delete(id);
    });
    this.pending.set(id, state);
    return state.promise;
  }
  async removeClient(id) {
    const client = this.clients.get(id);
    this.clients.delete(id);
    for (const [name, t] of this.registry) if (t.id === id) this.registry.delete(name);
    await client?.close();
  }
  async disconnect(id) {
    const state = this.pending.get(id);
    if (state) {
      state.cancelled = true;
      await state.client?.close().catch(() => {});
    }
    await this.removeClient(id);
    if (state) await state.promise.catch(() => {});
  }
  tools() {
    return [...this.registry.values()]
      .filter((t) => this.store.get(t.id)?.data.enabled === true)
      .map((t) => t.tool);
  }
  async call(name, args) {
    const entry = this.registry.get(name);
    if (!entry || this.store.get(entry.id)?.data.enabled !== true)
      throw new Error('Connection is disabled');
    return this.clients.get(entry.id).callTool({ name: entry.original, arguments: args });
  }
  async close() {
    this.closed = true;
    await Promise.allSettled(
      [...new Set([...this.clients.keys(), ...this.pending.keys()])].map((id) =>
        this.disconnect(id),
      ),
    );
  }
}
