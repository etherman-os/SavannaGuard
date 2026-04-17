export interface MousePoint {
  x: number;
  y: number;
  t: number;
}

export interface MouseData {
  straightLineRatio: number;
  avgVelocity: number;
  maxVelocity: number;
  directionChanges: number;
  totalMovement: number;
  pointCount: number;
}

export async function collectMouseData(): Promise<MouseData> {
  const points: MousePoint[] = [];
  const collectionMs = 2500 + Math.floor(Math.random() * 1500);

  const handler = (e: MouseEvent) => {
    points.push({ x: e.clientX, y: e.clientY, t: Date.now() });
  };

  document.addEventListener('mousemove', handler, { passive: true });

  await new Promise<void>((resolve) => setTimeout(resolve, collectionMs));

  document.removeEventListener('mousemove', handler);

  return calculateMouseMetrics(points);
}

function calculateMouseMetrics(points: MousePoint[]): MouseData {
  const defaultData: MouseData = {
    straightLineRatio: 1.0,
    avgVelocity: 0,
    maxVelocity: 0,
    directionChanges: 0,
    totalMovement: 0,
    pointCount: 0,
  };

  if (points.length < 3) return defaultData;

  const totalDist = calculateTotalDistance(points);
  const directDist = calculateDirectDistance(points);
  const straightLineRatio = totalDist > 0 ? directDist / totalDist : 1.0;

  const velocities = calculateVelocities(points);
  const avgVelocity = velocities.length > 0
    ? velocities.reduce((a, b) => a + b, 0) / velocities.length
    : 0;
  const maxVelocity = velocities.length > 0 ? Math.max(...velocities) : 0;

  const directionChanges = countDirectionChanges(points);

  return {
    straightLineRatio: Math.round(straightLineRatio * 100) / 100,
    avgVelocity: Math.round(avgVelocity * 100) / 100,
    maxVelocity: Math.round(maxVelocity * 100) / 100,
    directionChanges,
    totalMovement: Math.round(totalDist),
    pointCount: points.length,
  };
}

function calculateTotalDistance(points: MousePoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    total += Math.sqrt(dx * dx + dy * dy);
  }
  return total;
}

function calculateDirectDistance(points: MousePoint[]): number {
  if (points.length < 2) return 0;
  const dx = points[points.length - 1].x - points[0].x;
  const dy = points[points.length - 1].y - points[0].y;
  return Math.sqrt(dx * dx + dy * dy);
}

function calculateVelocities(points: MousePoint[]): number[] {
  const velocities: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    const dt = points[i].t - points[i - 1].t;
    if (dt > 0) {
      velocities.push(Math.sqrt(dx * dx + dy * dy) / dt);
    }
  }
  return velocities;
}

function countDirectionChanges(points: MousePoint[]): number {
  if (points.length < 3) return 0;

  let changes = 0;
  let prevAngle = Math.atan2(
    points[1].y - points[0].y,
    points[1].x - points[0].x
  );

  for (let i = 2; i < points.length; i++) {
    const angle = Math.atan2(
      points[i].y - points[i - 1].y,
      points[i].x - points[i - 1].x
    );
    let diff = Math.abs(angle - prevAngle);
    if (diff > Math.PI) diff = 2 * Math.PI - diff;

    if (diff > 0.5) {
      changes++;
    }
    prevAngle = angle;
  }

  return changes;
}

export function scoreMouse(data: MouseData): number {
  let score = 50;

  if (data.pointCount < 5) {
    score -= 20;
  } else if (data.pointCount > 20) {
    score += 10;
  }

  if (data.straightLineRatio > 0.95) {
    score -= 35;
  } else if (data.straightLineRatio > 0.8) {
    score -= 15;
  } else if (data.straightLineRatio < 0.5) {
    score += 10;
  }

  if (data.avgVelocity > 0 && data.avgVelocity < 2000) {
    score += 10;
  }

  if (data.directionChanges > 3) {
    score += 15;
  } else if (data.directionChanges === 0 && data.pointCount > 10) {
    score -= 20;
  }

  if (data.maxVelocity > 5000) {
    score -= 10;
  }

  return Math.max(0, Math.min(100, score));
}
