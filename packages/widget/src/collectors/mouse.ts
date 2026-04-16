interface MousePoint {
  x: number;
  y: number;
  t: number;
}

export async function collectMouseData(): Promise<{ straightLineRatio: number }> {
  const points: MousePoint[] = [];
  const COLLECTION_MS = 3000;

  const handler = (e: MouseEvent) => {
    points.push({ x: e.clientX, y: e.clientY, t: Date.now() });
  };

  document.addEventListener('mousemove', handler, { passive: true });

  await new Promise((resolve) => setTimeout(resolve, COLLECTION_MS));

  document.removeEventListener('mousemove', handler);

  return { straightLineRatio: calculateStraightLineRatio(points) };
}

function calculateStraightLineRatio(points: MousePoint[]): number {
  if (points.length < 3) return 1.0;
  const totalDist = points.reduce((acc, p, i) => {
    if (i === 0) return 0;
    const dx = p.x - points[i - 1].x;
    const dy = p.y - points[i - 1].y;
    return acc + Math.sqrt(dx * dx + dy * dy);
  }, 0);
  const directDist = Math.sqrt(
    (points[points.length - 1].x - points[0].x) ** 2 +
    (points[points.length - 1].y - points[0].y) ** 2
  );
  return totalDist > 0 ? directDist / totalDist : 1.0;
}