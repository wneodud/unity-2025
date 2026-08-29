export const ROTATION_TURN_RADIANS = Math.PI * 2;
export const ROTATION_DURATION_MS = 10_000;
export const ROTATION_ANGULAR_SPEED_RAD_PER_SEC = ROTATION_TURN_RADIANS / (ROTATION_DURATION_MS / 1000);
export const ROTATING_LANE_EDGE_INSET_PX = 34;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function rotationRadiansAtElapsed(elapsedMs, durationMs = ROTATION_DURATION_MS) {
  const duration = Math.max(1, Number(durationMs) || ROTATION_DURATION_MS);
  const elapsed = clamp(Number(elapsedMs) || 0, 0, duration);
  return elapsed / duration * ROTATION_TURN_RADIANS;
}

export function rotationAngleFromRemaining(remainingMs, durationMs = ROTATION_DURATION_MS) {
  const duration = Math.max(1, Number(durationMs) || ROTATION_DURATION_MS);
  const remaining = clamp(Number(remainingMs) || 0, 0, duration);
  return rotationRadiansAtElapsed(duration - remaining, duration);
}

export function rotatingLaneGeometry(
  viewportWidth,
  viewportHeight,
  angleRad,
  { edgeInsetPx = ROTATING_LANE_EDGE_INSET_PX } = {},
) {
  const width = Math.max(1, Number(viewportWidth) || 1);
  const height = Math.max(1, Number(viewportHeight) || 1);
  const centerX = width / 2;
  const centerY = height / 2;
  const angle = Number(angleRad) || 0;

  // Canvas positive rotation is visually clockwise. This is the screen-space
  // direction of the lane's local +Y axis after rotating by `angle`.
  const directionX = -Math.sin(angle);
  const directionY = Math.cos(angle);
  const epsilon = 1e-9;
  const xLimit = Math.abs(directionX) > epsilon
    ? centerX / Math.abs(directionX)
    : Number.POSITIVE_INFINITY;
  const yLimit = Math.abs(directionY) > epsilon
    ? centerY / Math.abs(directionY)
    : Number.POSITIVE_INFINITY;
  const halfLength = Math.min(xLimit, yLimit);
  const safeInset = Math.min(
    Math.max(0, Number(edgeInsetPx) || 0),
    Math.max(0, halfLength - 1),
  );
  const usableHalfLength = Math.max(1, halfLength - safeInset);

  const spawnPoint = {
    x: centerX - directionX * usableHalfLength,
    y: centerY - directionY * usableHalfLength,
  };
  const targetPoint = {
    x: centerX + directionX * usableHalfLength,
    y: centerY + directionY * usableHalfLength,
  };

  return {
    centerX,
    centerY,
    angle,
    directionX,
    directionY,
    halfLength,
    usableHalfLength,
    laneTopLocalY: -halfLength,
    laneBottomLocalY: halfLength,
    spawnLocalY: -usableHalfLength,
    targetLocalY: usableHalfLength,
    spawnPoint,
    targetPoint,
  };
}
