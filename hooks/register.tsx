// A row above the prompt once the prompt cache has gone cold, with what the next
// message would cost. It never blocks a message and makes no model calls.
//
// The timing rules are adapted from cache-tax by Karan Bansal (MIT): see
// LICENSE-cache-tax. Rates are from Anthropic's model table of 2026-10-06.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Cache } from '../types'

// Claude Code's usual cache lifetime. The engine does not report a shorter one
// to mods, so a session on the 5-minute lifetime is warned late.
const TTL_MS = 60 * 60 * 1000
const MIN_TOKENS = 50_000
const LONG_PROMPT_TOKENS = 100_000
const WRITE_MULTIPLE = 2

// Input $ per million tokens. A model id takes the first row it matches.
const INPUT_RATES: Array<[string | RegExp, number]> = [
  ['fable', 10],
  ['mythos', 10],
  ['opus-5-5', 4],
  ['opus-5', 5],
  // Opus 4 and 4.1 in every spelling, never Opus 4.5 and later.
  [/opus-4(?:-[01])?(?:$|[^-\d]|-20\d{6})/, 15],
  ['opus-4', 5],
  ['sonnet-5', 2],
  ['sonnet', 3],
  ['haiku-5-5', 0.1],
  ['3-5-haiku', 0.8],
  ['haiku-3-5', 0.8],
  ['haiku', 1],
]

const FRESH: Cache = { lastRequestAt: 0, context: 0, model: null, resumedAt: 0, resumeUsd: null }

const cache = atom({ plugin: 'comeback-cost', key: 'cache' } as const, FRESH)

export function writeRate(model: string | null, tokens: number): number | null {
  const id = (model ?? '').toLowerCase().replace(/[\s.]+/g, '-')
  if (id.includes('haiku-5-5') && tokens > LONG_PROMPT_TOKENS) return 0.5 * WRITE_MULTIPLE
  for (const [family, rate] of INPUT_RATES) {
    if (typeof family === 'string' ? id.includes(family) : family.test(id)) return rate * WRITE_MULTIPLE
  }
  return null
}

function formatUsd(usd: number): string {
  return '$' + (usd >= 100 ? usd.toFixed(0) : usd.toFixed(2))
}

function formatTokens(tokens: number): string {
  return tokens >= 1e6 ? (tokens / 1e6).toFixed(1) + 'M' : Math.round(tokens / 1000) + 'k'
}

/** The row to show at `now`, or undefined while the cache is warm or the context is small. */
export function coldLine(c: Cache, now: number): string | undefined {
  if (c.context < MIN_TOKENS) return undefined
  const isCold = c.lastRequestAt > 0 && now - c.lastRequestAt >= TTL_MS
  const mayBeCold = c.resumedAt > 0 && c.lastRequestAt === 0 && now - c.resumedAt >= TTL_MS
  if (!isCold && !mayBeCold) return undefined
  const rate = writeRate(c.model, c.context)
  const usd = c.resumeUsd ?? (rate === null ? null : (c.context * rate) / 1e6)
  const tokens = formatTokens(c.context)
  if (usd === null) return `cache ${isCold ? 'cold' : 'may be cold'} · next message re-writes ${tokens} tokens`
  return isCold
    ? `cache cold · next message about ${formatUsd(usd)} (${tokens} tokens)`
    : `cache may be cold · next message up to ${formatUsd(usd)} (${tokens} tokens)`
}

let hasBand = false
let timer: { cancel: () => void } | null = null

// Redraws now, and again at the moment the cache goes cold.
async function refresh($: EngineInterface) {
  const c = await read($, cache)
  const now = await $.clock.now()
  timer?.cancel()
  timer = null
  if (hasBand) $.ui.invalidate('ui.render')
  else $.ui.status(coldLine(c, now))
  const since = c.lastRequestAt || c.resumedAt
  if (since > 0 && since + TTL_MS > now) {
    timer = $.clock.after(since + TTL_MS - now, () => void refresh($))
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    hasBand = e.surface === 'terminal' || e.surface === 'desktop'
    const model = await $.session.model()
    const usage = await $.session.usage()
    const tokens = usage.context.tokens ?? 0
    await update($, cache, c => ({
      ...c,
      model: c.model ?? model,
      context: tokens || c.context,
      resumedAt: c.lastRequestAt === 0 && tokens > 0 ? usage.startedAt : 0,
    }))
    await refresh($)
    return result
  })

  // No session.start follows a /clear or an in-process resume.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') {
      await update($, cache, () => FRESH)
      await refresh($)
    }
    return next(e)
  })

  on('classic.SessionStart', async ($, e, next) => {
    const result = await next(e)
    if (e.source === 'clear') await update($, cache, () => FRESH)
    if (e.source === 'resume' || e.source === 'fork') {
      const now = await $.clock.now()
      const seconds = e.seconds_since_last_response
      await update($, cache, c => ({
        ...c,
        model: e.model ?? c.model,
        context: e.context_tokens || c.context,
        lastRequestAt: seconds === undefined ? c.lastRequestAt : now - seconds * 1000,
        resumedAt: seconds === undefined ? c.resumedAt : 0,
        resumeUsd: e.estimated_cache_write_usd ?? null,
      }))
    }
    await refresh($)
    return result
  })

  // A cache entry's lifetime runs from the start of the request that touches it.
  on('turn.step', async function* ($, e, next) {
    if (!e.agentId) {
      const now = await $.clock.now()
      await update($, cache, c => ({ ...c, lastRequestAt: now, resumedAt: 0, resumeUsd: null }))
    }
    return yield* next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId) return result
    const now = await $.clock.now()
    const usage = e.usage
    const live = usage ? (await $.session.usage()).context.tokens : undefined
    await update($, cache, c => {
      // A turn aborted before it sent anything touched no cache. When no step
      // stamped this turn, its end is the floor.
      const unstamped = (usage !== undefined || !e.isAborted) && now - c.lastRequestAt > e.durationMs
      const lastRequestAt = unstamped ? now : c.lastRequestAt
      const summed = usage ? usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens : 0
      return {
        ...c,
        lastRequestAt,
        model: usage?.model || c.model,
        context: usage ? (live && live > 0 ? live : summed) : c.context,
        resumedAt: lastRequestAt > 0 ? 0 : c.resumedAt,
      }
    })
    await refresh($)
    return result
  })

  // The next request writes the summary anyway, so no cold rewrite is ahead.
  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (!e.agentId) {
      await update($, cache, c => ({ ...c, context: 0 }))
      await refresh($)
    }
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rest = await next(e)
    if (e.props.hasSurvey || e.props.isWorking) return rest
    const text = coldLine(await read($, cache), await $.clock.now())
    if (text === undefined) return rest
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {rest}
        <Text color="warning" dimColor wrap="wrap">
          {text}
        </Text>
      </Box>
    )
  })
}
