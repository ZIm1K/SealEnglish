// Media providers (Gemini, ElevenLabs) answer 429/5xx during demand spikes; those pass in seconds,
// so a call is retried with backoff before the farm gives up on the asset.

/** Overload, rate limit, gateway or network hiccup — worth waiting out (unlike a bad key or no credits). */
export const isTransient = (e: unknown) =>
  /HTTP (408|429|5\d\d)\b|fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up/i.test(e instanceof Error ? `${e.message} ${String(e.cause ?? "")}` : String(e));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Runs `fn`, retrying transient failures: waits ≈4 s, 12 s, 36 s (plus jitter) between the 4 default tries. */
export async function withRetry<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= tries || !isTransient(e)) throw e;
      await sleep(4000 * 3 ** (attempt - 1) + Math.random() * 2000);
    }
  }
}
