import { b2Vec2 } from '@box2d/core';
import type { TwigSegmentTransform } from '../physics/Twig';

const DEFAULT_SMOOTHING_ALPHA = 0.34;
const SEGMENT_OVERLAP_RATIO = 0.26;
const VISUAL_THICKNESS_SCALE = 1.06;

type CachedRenderSegment = {
  x: number;
  y: number;
  angle: number;
  length: number;
  thickness: number;
};

const renderCache = new Map<string, CachedRenderSegment[]>();

const shortestAngleDelta = (from: number, to: number) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

const drawRoundedSegmentPath = (
  context: CanvasRenderingContext2D,
  halfLengthPx: number,
  halfThicknessPx: number,
) => {
  const radius = halfThicknessPx;
  const left = -halfLengthPx;
  const right = halfLengthPx;
  const top = -halfThicknessPx;
  const bottom = halfThicknessPx;

  context.beginPath();
  context.moveTo(left + radius, top);
  context.lineTo(right - radius, top);
  context.arc(right - radius, 0, radius, -Math.PI / 2, Math.PI / 2, false);
  context.lineTo(left + radius, bottom);
  context.arc(left + radius, 0, radius, Math.PI / 2, (3 * Math.PI) / 2, false);
  context.closePath();
};

const smoothSegments = (twigId: string, sourceSegments: TwigSegmentTransform[], smoothingAlpha: number) => {
  const clampedAlpha = Math.max(0, Math.min(1, smoothingAlpha));
  let cached = renderCache.get(twigId);

  if (!cached || cached.length !== sourceSegments.length) {
    cached = sourceSegments.map((segment) => ({
      x: segment.position.x,
      y: segment.position.y,
      angle: segment.angle,
      length: segment.length,
      thickness: segment.thickness,
    }));
    renderCache.set(twigId, cached);
    return cached;
  }

  for (let i = 0; i < sourceSegments.length; i += 1) {
    const source = sourceSegments[i];
    const target = cached[i];
    target.x += (source.position.x - target.x) * clampedAlpha;
    target.y += (source.position.y - target.y) * clampedAlpha;
    target.angle += shortestAngleDelta(target.angle, source.angle) * clampedAlpha;
    target.length = source.length;
    target.thickness = source.thickness;
  }

  return cached;
};

const drawSegmentList = (
  context: CanvasRenderingContext2D,
  segments: ReadonlyArray<CachedRenderSegment>,
  color: string,
  physicsScale: number,
) => {
  for (const segment of segments) {
    const halfLengthPx = (segment.length * (1 + SEGMENT_OVERLAP_RATIO) * 0.5) * physicsScale;
    const halfThicknessPx = (segment.thickness * VISUAL_THICKNESS_SCALE * 0.5) * physicsScale;

    context.save();
    context.translate(segment.x * physicsScale, segment.y * physicsScale);
    context.rotate(segment.angle);
    drawRoundedSegmentPath(context, halfLengthPx, halfThicknessPx);
    context.fillStyle = color;
    context.fill();
    context.strokeStyle = 'rgba(18, 14, 6, 0.2)';
    context.lineWidth = Math.max(1, halfThicknessPx * 0.2);
    context.stroke();
    context.restore();
  }

  if (segments.length === 0) {
    return;
  }

  const first = segments[0];
  const last = segments[segments.length - 1];
  const capRadiusPx = (first.thickness * VISUAL_THICKNESS_SCALE * 0.5) * physicsScale;
  const firstCapX = first.x - Math.cos(first.angle) * first.length * 0.5;
  const firstCapY = first.y - Math.sin(first.angle) * first.length * 0.5;
  const lastCapX = last.x + Math.cos(last.angle) * last.length * 0.5;
  const lastCapY = last.y + Math.sin(last.angle) * last.length * 0.5;

  context.fillStyle = color;
  context.beginPath();
  context.arc(firstCapX * physicsScale, firstCapY * physicsScale, capRadiusPx, 0, Math.PI * 2);
  context.fill();
  context.beginPath();
  context.arc(lastCapX * physicsScale, lastCapY * physicsScale, capRadiusPx, 0, Math.PI * 2);
  context.fill();
};

export const buildTwigPreviewSegments = (
  center: b2Vec2,
  length: number,
  thickness: number,
  segmentCount: number,
  angle: number,
): TwigSegmentTransform[] => {
  const safeSegmentCount = Math.max(3, Math.round(segmentCount));
  const segmentLength = Math.max(length, 0.6) / safeSegmentCount;
  const halfLength = Math.max(length, 0.6) / 2;
  const c = Math.cos(angle);
  const s = Math.sin(angle);

  const segments: TwigSegmentTransform[] = [];
  for (let i = 0; i < safeSegmentCount; i += 1) {
    const localX = -halfLength + segmentLength * (i + 0.5);
    segments.push({
      position: new b2Vec2(center.x + localX * c, center.y + localX * s),
      angle,
      length: segmentLength,
      thickness: Math.max(thickness, 0.12),
    });
  }

  return segments;
};

export const drawTwig = (
  context: CanvasRenderingContext2D,
  twigId: string,
  sourceSegments: TwigSegmentTransform[],
  color: string,
  physicsScale: number,
  smoothingAlpha = DEFAULT_SMOOTHING_ALPHA,
) => {
  const smoothedSegments = smoothSegments(twigId, sourceSegments, smoothingAlpha);
  drawSegmentList(context, smoothedSegments, color, physicsScale);
};

export const drawTwigPreview = (
  context: CanvasRenderingContext2D,
  sourceSegments: TwigSegmentTransform[],
  color: string,
  physicsScale: number,
  alpha = 1,
) => {
  if (sourceSegments.length === 0) {
    return;
  }
  const drawSegments = sourceSegments.map((segment) => ({
    x: segment.position.x,
    y: segment.position.y,
    angle: segment.angle,
    length: segment.length,
    thickness: segment.thickness,
  }));
  context.save();
  context.globalAlpha = alpha;
  drawSegmentList(context, drawSegments, color, physicsScale);
  context.restore();
};

export const pruneTwigRenderCache = (activeTwigIds: readonly string[]) => {
  const activeIds = new Set(activeTwigIds);
  for (const cachedId of renderCache.keys()) {
    if (!activeIds.has(cachedId)) {
      renderCache.delete(cachedId);
    }
  }
};
