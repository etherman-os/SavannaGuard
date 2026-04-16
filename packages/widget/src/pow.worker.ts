/// <reference lib="webworker" />

self.onmessage = async (e: MessageEvent<{ nonce: string; difficulty: number }>) => {
  const { nonce, difficulty } = e.data;
  let solution = BigInt(0);
  const maxSolutions = BigInt(2 ** 53); // Safe integer limit for JSON serialization
  while (solution < maxSolutions) {
    const hash = await sha256(nonce + solution.toString());
    if (hash.slice(0, difficulty) === '0'.repeat(difficulty)) {
      self.postMessage({ solution: solution.toString() });
      return;
    }
    solution++;
  }
  // If we exhaust the safe range, signal failure (null, not "null")
  self.postMessage({ solution: null });
};

async function sha256(input: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}