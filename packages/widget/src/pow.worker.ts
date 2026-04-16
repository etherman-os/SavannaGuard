/// <reference lib="webworker" />

self.onmessage = async (e: MessageEvent<{ nonce: string; difficulty: number }>) => {
  const { nonce, difficulty } = e.data;
  let solution = 0;
  while (true) {
    const hash = await sha256(nonce + solution.toString());
    if (hash.slice(0, difficulty) === '0'.repeat(difficulty)) {
      self.postMessage({ solution: solution.toString() });
      return;
    }
    solution++;
  }
};

async function sha256(input: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}