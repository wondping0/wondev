/**
 * A deliberate estimate, not a tokenizer.
 *
 * A real tokenizer would be a second runtime dependency and a model choice that goes stale;
 * wondev has one dependency and intends to keep it that way. Four characters per token is
 * the usual rule of thumb for prose, and every number derived from this is rendered behind a
 * `≈` that already promises approximation.
 *
 * The point of the figure is comparison — this note costs six times that one — and for that
 * a consistent estimate is as useful as an exact count.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** `640` reads as `640`; `2600` reads as `2.6k`. */
export function formatTokens(n: number): string {
  return n < 1000 ? String(n) : `${(n / 1000).toFixed(1)}k`;
}
