import { b2Vec2 } from '@box2d/core';
import type { TwigSegmentTransform } from '../physics/Twig';

const DEFAULT_SMOOTHING_ALPHA = 0.34;
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

type SpinePoint = {
  x: number;
  y: number;
};

const buildSpinePoints = (segments: ReadonlyArray<CachedRenderSegment>): SpinePoint[] => {
  if (segments.length === 0) {
    return [];
  }

  if (segments.length === 1) {
    const only = segments[0];
    const halfLength = only.length * 0.5;
    return [
      { x: only.x - Math.cos(only.angle) * halfLength, y: only.y - Math.sin(only.angle) * halfLength },
      { x: only.x + Math.cos(only.angle) * halfLength, y: only.y + Math.sin(only.angle) * halfLength },
    ];
  }

  const points: SpinePoint[] = [];
  const first = segments[0];
  const firstHalfLength = first.length * 0.5;
  points.push({
    x: first.x - Math.cos(first.angle) * firstHalfLength,
    y: first.y - Math.sin(first.angle) * firstHalfLength,
  });

  for (let i = 0; i < segments.length - 1; i += 1) {
    points.push({
      x: (segments[i].x + segments[i + 1].x) * 0.5,
      y: (segments[i].y + segments[i + 1].y) * 0.5,
    });
  }

  const last = segments[segments.length - 1];
  const lastHalfLength = last.length * 0.5;
  points.push({
    x: last.x + Math.cos(last.angle) * lastHalfLength,
    y: last.y + Math.sin(last.angle) * lastHalfLength,
  });

  return points;
};

const strokeSpine = (
  context: CanvasRenderingContext2D,
  points: ReadonlyArray<SpinePoint>,
  lineWidthPx: number,
) => {
  if (points.length < 2) {
    return;
  }
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) {
    context.lineTo(points[i].x, points[i].y);
  }
  context.lineWidth = lineWidthPx;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.stroke();
};

const drawSegmentList = (
  context: CanvasRenderingContext2D,
  segments: ReadonlyArray<CachedRenderSegment>,
  color: string,
  physicsScale: number,
) => {
  if (segments.length === 0) {
    return;
  }

  const points = buildSpinePoints(segments).map((point) => ({
    x: point.x * physicsScale,
    y: point.y * physicsScale,
  }));
  const thicknessPx = Math.max(1, (segments[0].thickness * VISUAL_THICKNESS_SCALE) * physicsScale);

  context.save();
  context.strokeStyle = 'rgba(18, 14, 6, 0.2)';
  strokeSpine(context, points, thicknessPx * 1.14);
  context.strokeStyle = color;
  strokeSpine(context, points, thicknessPx);
  context.restore();
};

export const buildTwigPreviewSegments = (
  center: b2Vec2,
  length: number,
  thickness: number,
  segmentCount: number,
  angle: number,
): TwigSegmentTransform[] => {
  const safeSegmentCount = Math.max(1, Math.round(segmentCount));
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
