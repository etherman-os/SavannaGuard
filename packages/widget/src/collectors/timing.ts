let startTime = Date.now();

export function collectTiming(): { timeOnPage: number } {
  return { timeOnPage: Date.now() - startTime };
}

export function resetTiming(): void {
  startTime = Date.now();
}