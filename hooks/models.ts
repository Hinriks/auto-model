// Tiers from weakest to strongest; a pick is a quality floor, so any
// stronger tier may serve it when that is cheaper.
export const TIERS = ['haiku', 'sonnet', 'opus'] as const
export type Tier = (typeof TIERS)[number]

// `turn.step` sends its model name to the API as written, with no alias
// resolution, so each tier names a full model id. Update these, and PRICES,
// when a new model generation ships.
export const MODEL_IDS: Record<Tier, string> = {
  haiku: 'claude-haiku-5-5',
  sonnet: 'claude-sonnet-5-5',
  opus: 'claude-opus-5-5',
}

// USD per million tokens. Claude Code writes the 1-hour prompt cache, which
// costs 2x input; Haiku's cache read is assumed at 0.1x input. Haiku 5.5
// bills 5x once a prompt passes 100K tokens.
type Price = { input: number; output: number; read: number; write: number }
const price = (input: number, output: number, read: number): Price => ({
  input,
  output,
  read,
  write: input * 2,
})
const PRICES: Record<Tier, Price> = {
  haiku: price(0.1, 0.5, 0.01),
  sonnet: price(2, 10, 0.2),
  opus: price(4, 20, 0.2),
}
const HAIKU_LONG = price(0.5, 2.5, 0.05)
const HAIKU_LONG_FROM = 100_000

// What a typical turn looks like; used only to compare tiers, never billed.
const EXPECTED_STEPS = 3
const EXPECTED_OUTPUT_TOKENS = 3_000

export const tierOf = (model: string): Tier | undefined =>
  TIERS.find(tier => model.includes(tier))

const priceOf = (tier: Tier, contextTokens: number): Price =>
  tier === 'haiku' && contextTokens > HAIKU_LONG_FROM ? HAIKU_LONG : PRICES[tier]

/**
 * Estimated cost of running one turn on `tier`, given how much of the
 * conversation that model already holds in its prompt cache. Caches are
 * per model, so moving to a model that has none rewrites the whole context.
 */
export function turnCost(tier: Tier, contextTokens: number, cachedTokens: number): number {
  const p = priceOf(tier, contextTokens)
  const cached = Math.min(cachedTokens, contextTokens)
  const firstStep = cached * p.read + (contextTokens - cached) * p.write
  const laterSteps = (EXPECTED_STEPS - 1) * contextTokens * p.read

  return (firstStep + laterSteps + EXPECTED_OUTPUT_TOKENS * p.output) / 1_000_000
}

/**
 * The cheapest tier at or above `wanted`; ties go to the weaker tier.
 */
export function cheapestTier(
  wanted: Tier,
  contextTokens: number,
  cachedTokens: (tier: Tier) => number,
): Tier {
  const candidates = TIERS.slice(TIERS.indexOf(wanted))

  return candidates.reduce((best, tier) =>
    turnCost(tier, contextTokens, cachedTokens(tier)) <
    turnCost(best, contextTokens, cachedTokens(best))
      ? tier
      : best,
  )
}
