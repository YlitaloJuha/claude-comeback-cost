export type Cache = {
  /** When the last main request started; 0 when none is known. */
  lastRequestAt: number
  /** Tokens a cold message would write again; 0 right after a compaction. */
  context: number
  model: string | null
  /** A resumed session with no time for its last response: when it launched. */
  resumedAt: number
  /** The engine's own estimate for a resumed session, until a request goes out. */
  resumeUsd: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'comeback-cost': { cache: Cache }
  }
}
