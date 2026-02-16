import { initDebugOverlay } from './debugOverlay';

import {
  b2BodyType,
  b2PolygonShape,
  b2Vec2,
  b2World,
} from '@box2d/core';

const PHYSICS_SCALE = 30;
const TIME_STEP = 1 / 60;
const STEP_CONFIG = { velocityIterations: 8, positionIterations: 3 } as const;
const MAX_DEVICE_PIXEL_RATIO = 2;
const MIN_WORLD_WIDTH_METERS = 0;
const SIDE_PADDING_PX = 0;
const TARGET_SHAPE_MASS = 1;
const MENU_HEIGHT_PX = 180;
const MENU_PADDING_PX = 16;
const MENU_GAP_PX = 12;
const MENU_CARD_CORNER_RADIUS = 14;

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('Missing #app container');
}

app.style.position = 'relative';

const canvas = document.createElement('canvas');
const context = canvas.getContext('2d');
if (!context) {
  throw new Error('Canvas 2D context unavailable');
}

canvas.style.width = '100%';
canvas.style.height = '100%';
canvas.style.touchAction = 'none';

const applyButton = document.createElement('button');
applyButton.type = 'button';
applyButton.textContent = 'Apply';
applyButton.style.position = 'absolute';
applyButton.style.right = '20px';
applyButton.style.bottom = '20px';
applyButton.style.height = '44px';
applyButton.style.padding = '0 18px';
applyButton.style.border = 'none';
applyButton.style.borderRadius = '999px';
applyButton.style.font = '600 15px system-ui';
applyButton.style.cursor = 'pointer';
applyButton.style.background = '#38bdf8';
applyButton.style.color = '#04111f';
applyButton.style.boxShadow = '0 8px 24px rgb(0 0 0 / 25%)';

app.append(canvas, applyButton);

initDebugOverlay();
console.log('Debug overlay initialized');

const world = b2World.Create(new b2Vec2(0, 10));

type FallingShape = {
  body: ReturnType<typeof world.CreateBody>;
  color: string;
  vertices: b2Vec2[];
};

type PieceTemplate = {
  vertices: b2Vec2[];
  color: string;
};

type PointerSample = {
  start: b2Vec2;
  current: b2Vec2;
};

type PlacementState = {
  template: PieceTemplate;
  position: b2Vec2;
  angle: number;
  pointers: Map<number, PointerSample>;
  gestureBasePosition: b2Vec2;
  gestureBaseAngle: number;
};

type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const shapes: FallingShape[] = [];
let menuTemplates: PieceTemplate[] = [];

let floorBody: ReturnType<typeof world.CreateBody> | undefined;
let leftWallBody: ReturnType<typeof world.CreateBody> | undefined;
let rightWallBody: ReturnType<typeof world.CreateBody> | undefined;
let canvasWidth = 0;
let canvasHeight = 0;
let worldCanvasHeight = 0;
let worldHalfWidth = MIN_WORLD_WIDTH_METERS / 2;
let worldFloorY = 22;
let worldTopPadding = 2;
let placementState: PlacementState | undefined;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const cloneVec2 = (value: b2Vec2) => new b2Vec2(value.x, value.y);

const randomColor = () => `hsl(${Math.floor(Math.random() * 360)} 90% 65%)`;

const getPolygonArea = (vertices: b2Vec2[]) => {
  let signedArea = 0;
  for (let i = 0; i < vertices.length; i += 1) {
    const current = vertices[i];
    const next = vertices[(i + 1) % vertices.length];
    signedArea += current.x * next.y - next.x * current.y;
  }

  return Math.abs(signedArea) * 0.5;
};

const toWorldFromCanvas = (x: number, y: number) => {
  const clampedY = clamp(y, 0, worldCanvasHeight);
  return new b2Vec2((x - canvasWidth / 2) / PHYSICS_SCALE, clampedY / PHYSICS_SCALE);
};

const toCanvasFromWorld = (x: number, y: number) => ({
  x: x * PHYSICS_SCALE + canvasWidth / 2,
  y: y * PHYSICS_SCALE,
});

const toLocalFromBody = (bodyPosition: b2Vec2, bodyAngle: number, worldPoint: b2Vec2) => {
  const dx = worldPoint.x - bodyPosition.x;
  const dy = worldPoint.y - bodyPosition.y;
  const cos = Math.cos(bodyAngle);
  const sin = Math.sin(bodyAngle);
  return new b2Vec2(cos * dx + sin * dy, -sin * dx + cos * dy);
};

const toWorldFromBody = (bodyPosition: b2Vec2, bodyAngle: number, localPoint: b2Vec2) => {
  const cos = Math.cos(bodyAngle);
  const sin = Math.sin(bodyAngle);
  return new b2Vec2(
    bodyPosition.x + cos * localPoint.x - sin * localPoint.y,
    bodyPosition.y + sin * localPoint.x + cos * localPoint.y,
  );
};

const createOrganicLongShape = () => {
  const length = 1.8 + Math.random() * 1.8;
  const halfLength = length / 2;

  // Independent top/bottom offsets avoid parallel edges and keep a hand-drawn look.
  const topLeft = 0.16 + Math.random() * 0.2;
  const topMiddle = 0.2 + Math.random() * 0.22;
  const topRight = 0.15 + Math.random() * 0.22;

  const bottomRight = 0.14 + Math.random() * 0.24;
  const bottomMiddle = 0.2 + Math.random() * 0.22;
  const bottomLeft = 0.17 + Math.random() * 0.2;

  return [
    new b2Vec2(-halfLength, -topLeft),
    new b2Vec2(-halfLength * 0.22, -topMiddle),
    new b2Vec2(halfLength, -topRight),
    new b2Vec2(halfLength * 0.88, bottomRight),
    new b2Vec2(halfLength * 0.08, bottomMiddle),
    new b2Vec2(-halfLength * 0.94, bottomLeft),
  ];
};

const createPieceTemplates = (count: number) => Array.from({ length: count }, () => ({
  vertices: createOrganicLongShape(),
  color: randomColor(),
}));

const rebuildBounds = () => {
  if (floorBody) {
    world.DestroyBody(floorBody);
  }
  if (leftWallBody) {
    world.DestroyBody(leftWallBody);
  }
  if (rightWallBody) {
    world.DestroyBody(rightWallBody);
  }

  const wallThickness = 0.5;
  const floorHalfHeight = 0.5;
  const worldHeight = worldCanvasHeight / PHYSICS_SCALE;
  worldHalfWidth = Math.max(MIN_WORLD_WIDTH_METERS / 2, canvasWidth / (2 * PHYSICS_SCALE) - SIDE_PADDING_PX / PHYSICS_SCALE);
  worldFloorY = worldHeight - 2;
  worldTopPadding = 1.5;

  floorBody = world.CreateBody({ type: b2BodyType.b2_staticBody });
  floorBody.CreateFixture({
    shape: new b2PolygonShape().SetAsBox(worldHalfWidth + 4, floorHalfHeight, { x: 0, y: worldFloorY }, 0),
    friction: 0.7,
  });

  leftWallBody = world.CreateBody({ type: b2BodyType.b2_staticBody });
  leftWallBody.CreateFixture({
    shape: new b2PolygonShape().SetAsBox(wallThickness, worldHeight, { x: -worldHalfWidth, y: worldHeight / 2 }, 0),
  });

  rightWallBody = world.CreateBody({ type: b2BodyType.b2_staticBody });
  rightWallBody.CreateFixture({
    shape: new b2PolygonShape().SetAsBox(wallThickness, worldHeight, { x: worldHalfWidth, y: worldHeight / 2 }, 0),
  });
};

const resize = () => {
  const viewport = window.visualViewport;
  const width = Math.max(1, Math.round(viewport?.width ?? window.innerWidth));
  const height = Math.max(1, Math.round(viewport?.height ?? window.innerHeight));
  const pixelRatio = Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO);

  canvasWidth = width;
  canvasHeight = height;
  worldCanvasHeight = Math.max(1, canvasHeight - MENU_HEIGHT_PX);

  canvas.width = Math.round(width * pixelRatio);
  canvas.height = Math.round(height * pixelRatio);
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  rebuildBounds();
};

const getCanvasPoint = (event: PointerEvent) => {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
};

const getMenuCards = (): Rect[] => {
  const totalGap = MENU_GAP_PX * 2;
  const availableWidth = canvasWidth - MENU_PADDING_PX * 2 - totalGap;
  const cardWidth = Math.max(80, availableWidth / 3);
  const cardHeight = MENU_HEIGHT_PX - MENU_PADDING_PX * 2;
  const startX = MENU_PADDING_PX;
  const y = worldCanvasHeight + MENU_PADDING_PX;

  return [0, 1, 2].map((index) => ({
    x: startX + index * (cardWidth + MENU_GAP_PX),
    y,
    width: cardWidth,
    height: cardHeight,
  }));
};

const isPointInRect = (x: number, y: number, rect: Rect) => (
  x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height
);

const setApplyButtonEnabled = (enabled: boolean) => {
  applyButton.disabled = !enabled;
  applyButton.style.opacity = enabled ? '1' : '0.55';
  applyButton.style.cursor = enabled ? 'pointer' : 'default';
};

const createDynamicBodyFromTemplate = (template: PieceTemplate, position: b2Vec2, angle: number) => {
  const body = world.CreateBody({
    type: b2BodyType.b2_dynamicBody,
    position,
    angle,
    angularVelocity: Math.random() * 2 - 1,
  });

  const shape = new b2PolygonShape();
  shape.Set(template.vertices, template.vertices.length);

  const polygonArea = getPolygonArea(template.vertices);
  const density = TARGET_SHAPE_MASS / Math.max(polygonArea, 0.01);

  body.CreateFixture({
    shape,
    density,
    friction: 0.55,
    restitution: 0.15,
  });

  shapes.push({ body, vertices: template.vertices, color: template.color });
};

const resetGestureReference = () => {
  if (!placementState) {
    return;
  }

  placementState.gestureBasePosition = cloneVec2(placementState.position);
  placementState.gestureBaseAngle = placementState.angle;

  for (const sample of placementState.pointers.values()) {
    sample.start = cloneVec2(sample.current);
  }
};

const updatePlacementTransform = () => {
  if (!placementState || placementState.pointers.size === 0) {
    return;
  }

  const entries = [...placementState.pointers.entries()].sort((a, b) => a[0] - b[0]);

  if (entries.length === 1) {
    const [, sample] = entries[0];
    const deltaX = sample.current.x - sample.start.x;
    const deltaY = sample.current.y - sample.start.y;

    placementState.position = new b2Vec2(
      placementState.gestureBasePosition.x + deltaX,
      placementState.gestureBasePosition.y + deltaY,
    );
    placementState.angle = placementState.gestureBaseAngle;
    return;
  }

  const [, first] = entries[0];
  const [, second] = entries[1];

  const startCentroid = new b2Vec2(
    (first.start.x + second.start.x) * 0.5,
    (first.start.y + second.start.y) * 0.5,
  );
  const currentCentroid = new b2Vec2(
    (first.current.x + second.current.x) * 0.5,
    (first.current.y + second.current.y) * 0.5,
  );

  const startVector = new b2Vec2(second.start.x - first.start.x, second.start.y - first.start.y);
  const currentVector = new b2Vec2(second.current.x - first.current.x, second.current.y - first.current.y);

  const startAngle = Math.atan2(startVector.y, startVector.x);
  const currentAngle = Math.atan2(currentVector.y, currentVector.x);

  placementState.position = new b2Vec2(
    placementState.gestureBasePosition.x + (currentCentroid.x - startCentroid.x),
    placementState.gestureBasePosition.y + (currentCentroid.y - startCentroid.y),
  );
  placementState.angle = placementState.gestureBaseAngle + (currentAngle - startAngle);
};

const beginPlacementFromTemplate = (template: PieceTemplate, worldPoint: b2Vec2) => {
  placementState = {
    template,
    position: cloneVec2(worldPoint),
    angle: 0,
    pointers: new Map(),
    gestureBasePosition: cloneVec2(worldPoint),
    gestureBaseAngle: 0,
  };

  setApplyButtonEnabled(true);
};

const addPlacementPointer = (pointerId: number, worldPoint: b2Vec2) => {
  if (!placementState) {
    return;
  }

  placementState.pointers.set(pointerId, {
    start: cloneVec2(worldPoint),
    current: cloneVec2(worldPoint),
  });
  resetGestureReference();
};

const removePlacementPointer = (pointerId: number) => {
  if (!placementState) {
    return;
  }

  placementState.pointers.delete(pointerId);
  if (placementState.pointers.size > 0) {
    resetGestureReference();
  }
};

const commitPlacement = () => {
  if (!placementState) {
    return;
  }

  createDynamicBodyFromTemplate(
    placementState.template,
    cloneVec2(placementState.position),
    placementState.angle,
  );

  placementState = undefined;
  menuTemplates = createPieceTemplates(3);
  setApplyButtonEnabled(false);
};

applyButton.addEventListener('click', commitPlacement);

const onPointerDown = (event: PointerEvent) => {
  const canvasPoint = getCanvasPoint(event);
  const worldPoint = toWorldFromCanvas(canvasPoint.x, canvasPoint.y);

  if (!placementState) {
    if (canvasPoint.y < worldCanvasHeight) {
      return;
    }

    const cards = getMenuCards();
    const cardIndex = cards.findIndex((card) => isPointInRect(canvasPoint.x, canvasPoint.y, card));
    if (cardIndex === -1) {
      return;
    }

    beginPlacementFromTemplate(menuTemplates[cardIndex], worldPoint);
  }

  addPlacementPointer(event.pointerId, worldPoint);
  canvas.setPointerCapture(event.pointerId);
};

const onPointerMove = (event: PointerEvent) => {
  if (!placementState) {
    return;
  }

  const sample = placementState.pointers.get(event.pointerId);
  if (!sample) {
    return;
  }

  const canvasPoint = getCanvasPoint(event);
  sample.current = toWorldFromCanvas(canvasPoint.x, canvasPoint.y);
  updatePlacementTransform();
};

const onPointerEnd = (event: PointerEvent) => {
  if (!placementState) {
    return;
  }

  removePlacementPointer(event.pointerId);
};

canvas.addEventListener('pointerdown', onPointerDown);
canvas.addEventListener('pointermove', onPointerMove);
canvas.addEventListener('pointerup', onPointerEnd);
canvas.addEventListener('pointercancel', onPointerEnd);

const drawRoundedRect = (rect: Rect, radius: number) => {
  context.beginPath();
  context.moveTo(rect.x + radius, rect.y);
  context.lineTo(rect.x + rect.width - radius, rect.y);
  context.quadraticCurveTo(rect.x + rect.width, rect.y, rect.x + rect.width, rect.y + radius);
  context.lineTo(rect.x + rect.width, rect.y + rect.height - radius);
  context.quadraticCurveTo(rect.x + rect.width, rect.y + rect.height, rect.x + rect.width - radius, rect.y + rect.height);
  context.lineTo(rect.x + radius, rect.y + rect.height);
  context.quadraticCurveTo(rect.x, rect.y + rect.height, rect.x, rect.y + rect.height - radius);
  context.lineTo(rect.x, rect.y + radius);
  context.quadraticCurveTo(rect.x, rect.y, rect.x + radius, rect.y);
  context.closePath();
};

const drawTemplate = (template: PieceTemplate, centerX: number, centerY: number, scale: number, angle = 0, alpha = 1) => {
  context.save();
  context.translate(centerX, centerY);
  context.rotate(angle);
  context.scale(scale, scale);
  context.globalAlpha = alpha;
  context.fillStyle = template.color;
  context.beginPath();
  template.vertices.forEach((vertex, index) => {
    if (index === 0) {
      context.moveTo(vertex.x * PHYSICS_SCALE, vertex.y * PHYSICS_SCALE);
    } else {
      context.lineTo(vertex.x * PHYSICS_SCALE, vertex.y * PHYSICS_SCALE);
    }
  });
  context.closePath();
  context.fill();
  context.restore();
};

const renderWorld = () => {
  context.save();
  context.beginPath();
  context.rect(0, 0, canvasWidth, worldCanvasHeight);
  context.clip();

  context.fillStyle = '#0b1020';
  context.fillRect(0, 0, canvasWidth, worldCanvasHeight);

  context.save();
  context.translate(canvasWidth / 2, 0);

  for (const shape of shapes) {
    const position = shape.body.GetPosition();
    const angle = shape.body.GetAngle();

    context.save();
    context.translate(position.x * PHYSICS_SCALE, position.y * PHYSICS_SCALE);
    context.rotate(angle);
    context.fillStyle = shape.color;
    context.beginPath();
    shape.vertices.forEach((vertex, index) => {
      const x = vertex.x * PHYSICS_SCALE;
      const y = vertex.y * PHYSICS_SCALE;
      if (index === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
    });
    context.closePath();
    context.fill();
    context.restore();
  }

  context.restore();

  if (placementState) {
    const preview = toCanvasFromWorld(placementState.position.x, placementState.position.y);
    drawTemplate(placementState.template, preview.x, preview.y, 1, placementState.angle, 0.85);
  }

  context.restore();
};

const renderMenu = () => {
  context.fillStyle = '#101827';
  context.fillRect(0, worldCanvasHeight, canvasWidth, MENU_HEIGHT_PX);

  context.strokeStyle = '#2a364b';
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(0, worldCanvasHeight + 0.5);
  context.lineTo(canvasWidth, worldCanvasHeight + 0.5);
  context.stroke();

  const cards = getMenuCards();
  cards.forEach((card, index) => {
    const template = menuTemplates[index];
    drawRoundedRect(card, MENU_CARD_CORNER_RADIUS);
    context.fillStyle = '#1a2436';
    context.fill();

    context.lineWidth = 1;
    context.strokeStyle = '#334155';
    context.stroke();

    const xs = template.vertices.map((vertex) => vertex.x * PHYSICS_SCALE);
    const ys = template.vertices.map((vertex) => vertex.y * PHYSICS_SCALE);
    const width = Math.max(...xs) - Math.min(...xs);
    const height = Math.max(...ys) - Math.min(...ys);
    const scale = Math.min((card.width - 20) / Math.max(width, 1), (card.height - 20) / Math.max(height, 1));

    drawTemplate(
      template,
      card.x + card.width / 2,
      card.y + card.height / 2,
      scale,
      0,
      0.95,
    );
  });
};

const render = () => {
  context.clearRect(0, 0, canvasWidth, canvasHeight);
  renderWorld();
  renderMenu();
};

const tick = () => {
  if (!placementState) {
    world.Step(TIME_STEP, STEP_CONFIG);
  }

  if (shapes.length > 100) {
    const removed = shapes.splice(0, shapes.length - 100);
    for (const shape of removed) {
      world.DestroyBody(shape.body);
    }
  }

  render();
  requestAnimationFrame(tick);
};

window.addEventListener('resize', resize);
window.visualViewport?.addEventListener('resize', resize);

menuTemplates = createPieceTemplates(3);
setApplyButtonEnabled(false);
resize();
requestAnimationFrame(tick);
