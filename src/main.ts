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
const MENU_HEIGHT_PX = 160;
const MENU_PADDING_PX = 16;
const MENU_GAP_PX = 12;
const APPLY_BUTTON_WIDTH_PX = 120;
const APPLY_BUTTON_HEIGHT_PX = 52;

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('Missing #app container');
}

const canvas = document.createElement('canvas');
const context = canvas.getContext('2d');
if (!context) {
  throw new Error('Canvas 2D context unavailable');
}

canvas.style.width = '100%';
canvas.style.height = '100%';
canvas.style.touchAction = 'none';

app.append(canvas);

initDebugOverlay();

const world = b2World.Create(new b2Vec2(0, 10));
type FallingShape = {
  body: ReturnType<typeof world.CreateBody>;
  color: string;
  vertices: b2Vec2[];
};

type PieceTemplate = {
  id: string;
  vertices: b2Vec2[];
  color: string;
};

type PlacementState = {
  template: PieceTemplate;
  position: b2Vec2;
  angle: number;
  activePointerId: number | null;
  pointerOffset: b2Vec2;
};

type GestureState = {
  pointerA: number;
  pointerB: number;
  initialMid: b2Vec2;
  initialAngle: number;
  initialDistance: number;
  pieceInitialPosition: b2Vec2;
  pieceInitialAngle: number;
};

type PieceCardLayout = {
  template: PieceTemplate;
  x: number;
  y: number;
  width: number;
  height: number;
};

const shapes: FallingShape[] = [];
const activePointers = new Map<number, b2Vec2>();

let floorBody: ReturnType<typeof world.CreateBody> | undefined;
let leftWallBody: ReturnType<typeof world.CreateBody> | undefined;
let rightWallBody: ReturnType<typeof world.CreateBody> | undefined;
let canvasWidth = 0;
let canvasHeight = 0;
let worldPixelHeight = 0;
let worldHalfWidth = MIN_WORLD_WIDTH_METERS / 2;
let worldFloorY = 22;
let palette: PieceTemplate[] = [];
let paletteCards: PieceCardLayout[] = [];
let applyButtonRect = { x: 0, y: 0, width: APPLY_BUTTON_WIDTH_PX, height: APPLY_BUTTON_HEIGHT_PX };
let placement: PlacementState | undefined;
let gesture: GestureState | undefined;
let pieceCounter = 0;

const randomColor = () => `hsl(${Math.floor(Math.random() * 360)} 85% 65%)`;

const getPolygonArea = (vertices: b2Vec2[]) => {
  let signedArea = 0;
  for (let i = 0; i < vertices.length; i += 1) {
    const current = vertices[i];
    const next = vertices[(i + 1) % vertices.length];
    signedArea += current.x * next.y - next.x * current.y;
  }

  return Math.abs(signedArea) * 0.5;
};

const toWorldFromCanvas = (x: number, y: number) => new b2Vec2((x - canvasWidth / 2) / PHYSICS_SCALE, y / PHYSICS_SCALE);

const createOrganicLongShape = () => {
  const length = 1.8 + Math.random() * 1.8;
  const halfLength = length / 2;

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

const createTemplate = (): PieceTemplate => {
  pieceCounter += 1;
  return {
    id: `piece-${pieceCounter}`,
    vertices: createOrganicLongShape(),
    color: randomColor(),
  };
};

const refillPalette = () => {
  palette = [createTemplate(), createTemplate(), createTemplate()];
};

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
  const worldHeight = worldPixelHeight / PHYSICS_SCALE;
  worldHalfWidth = Math.max(MIN_WORLD_WIDTH_METERS / 2, canvasWidth / (2 * PHYSICS_SCALE) - SIDE_PADDING_PX / PHYSICS_SCALE);
  worldFloorY = worldHeight - 1;

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

const rebuildMenuLayout = () => {
  const menuTop = worldPixelHeight;
  const contentY = menuTop + MENU_PADDING_PX;

  applyButtonRect = {
    x: canvasWidth - MENU_PADDING_PX - APPLY_BUTTON_WIDTH_PX,
    y: contentY + 40,
    width: APPLY_BUTTON_WIDTH_PX,
    height: APPLY_BUTTON_HEIGHT_PX,
  };

  const cardsAvailableWidth = Math.max(120, applyButtonRect.x - MENU_PADDING_PX * 2 - MENU_GAP_PX * 2);
  const cardWidth = cardsAvailableWidth / 3;
  const cardHeight = MENU_HEIGHT_PX - MENU_PADDING_PX * 2;

  paletteCards = palette.map((template, index) => ({
    template,
    x: MENU_PADDING_PX + index * (cardWidth + MENU_GAP_PX),
    y: contentY,
    width: cardWidth,
    height: cardHeight,
  }));
};

const resize = () => {
  const viewport = window.visualViewport;
  const width = Math.max(1, Math.round(viewport?.width ?? window.innerWidth));
  const height = Math.max(1, Math.round(viewport?.height ?? window.innerHeight));
  const pixelRatio = Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO);

  canvasWidth = width;
  canvasHeight = height;
  worldPixelHeight = Math.max(120, canvasHeight - MENU_HEIGHT_PX);

  canvas.width = Math.round(width * pixelRatio);
  canvas.height = Math.round(height * pixelRatio);
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

  rebuildBounds();
  rebuildMenuLayout();
};

const spawnPlacedShape = (template: PieceTemplate, position: b2Vec2, angle: number) => {
  const body = world.CreateBody({
    type: b2BodyType.b2_dynamicBody,
    position,
    angle,
  });

  const polygon = new b2PolygonShape();
  polygon.Set(template.vertices, template.vertices.length);

  const area = getPolygonArea(template.vertices);
  const density = TARGET_SHAPE_MASS / Math.max(area, 0.01);

  body.CreateFixture({
    shape: polygon,
    density,
    friction: 0.55,
    restitution: 0.15,
  });

  shapes.push({
    body,
    color: template.color,
    vertices: template.vertices,
  });
};

const transformedVertices = (vertices: b2Vec2[], position: b2Vec2, angle: number) => {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return vertices.map((vertex) => new b2Vec2(
    position.x + cos * vertex.x - sin * vertex.y,
    position.y + sin * vertex.x + cos * vertex.y,
  ));
};

const drawPolygon = (vertices: b2Vec2[]) => {
  context.beginPath();
  vertices.forEach((v, i) => {
    const x = v.x * PHYSICS_SCALE;
    const y = v.y * PHYSICS_SCALE;
    if (i === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  });
  context.closePath();
};

const renderWorld = () => {
  context.save();
  context.beginPath();
  context.rect(0, 0, canvasWidth, worldPixelHeight);
  context.clip();

  context.fillStyle = '#0b1020';
  context.fillRect(0, 0, canvasWidth, worldPixelHeight);

  context.save();
  context.translate(canvasWidth / 2, 0);

  for (const shape of shapes) {
    const position = shape.body.GetPosition();
    const angle = shape.body.GetAngle();
    const worldVertices = transformedVertices(shape.vertices, position, angle);
    context.fillStyle = shape.color;
    drawPolygon(worldVertices);
    context.fill();
  }

  if (placement) {
    const previewVertices = transformedVertices(placement.template.vertices, placement.position, placement.angle);
    context.fillStyle = `${placement.template.color}cc`;
    drawPolygon(previewVertices);
    context.fill();

    context.strokeStyle = '#ffffffaa';
    context.lineWidth = 2;
    drawPolygon(previewVertices);
    context.stroke();
  }

  context.restore();
  context.restore();
};

const fitTemplateToCardScale = (template: PieceTemplate, maxWidth: number, maxHeight: number) => {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const v of template.vertices) {
    minX = Math.min(minX, v.x);
    maxX = Math.max(maxX, v.x);
    minY = Math.min(minY, v.y);
    maxY = Math.max(maxY, v.y);
  }

  const width = Math.max(0.1, maxX - minX);
  const height = Math.max(0.1, maxY - minY);

  return Math.min(maxWidth / (width * PHYSICS_SCALE), maxHeight / (height * PHYSICS_SCALE));
};

const renderMenu = () => {
  const menuTop = worldPixelHeight;
  context.fillStyle = '#141b2e';
  context.fillRect(0, menuTop, canvasWidth, MENU_HEIGHT_PX);

  context.strokeStyle = '#25304f';
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(0, menuTop + 1);
  context.lineTo(canvasWidth, menuTop + 1);
  context.stroke();

  for (const card of paletteCards) {
    context.fillStyle = '#1b2540';
    context.fillRect(card.x, card.y, card.width, card.height);

    context.strokeStyle = '#334470';
    context.lineWidth = 2;
    context.strokeRect(card.x, card.y, card.width, card.height);

    const centerX = card.x + card.width / 2;
    const centerY = card.y + card.height / 2;
    const scale = fitTemplateToCardScale(card.template, card.width * 0.7, card.height * 0.7);

    context.save();
    context.translate(centerX, centerY);
    context.scale(scale, scale);
    context.fillStyle = card.template.color;

    context.beginPath();
    card.template.vertices.forEach((vertex, index) => {
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

  const isApplyEnabled = Boolean(placement);
  context.fillStyle = isApplyEnabled ? '#2dbf6e' : '#4c5a76';
  context.fillRect(applyButtonRect.x, applyButtonRect.y, applyButtonRect.width, applyButtonRect.height);

  context.fillStyle = 'white';
  context.font = '600 20px system-ui';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText('Apply', applyButtonRect.x + applyButtonRect.width / 2, applyButtonRect.y + applyButtonRect.height / 2);
};

const render = () => {
  context.clearRect(0, 0, canvasWidth, canvasHeight);
  renderWorld();
  renderMenu();
};

const cardAtPoint = (x: number, y: number) => paletteCards.find((card) => x >= card.x && x <= card.x + card.width && y >= card.y && y <= card.y + card.height);

const inRect = (x: number, y: number, rect: { x: number; y: number; width: number; height: number }) => x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;

const beginPlacementFromCard = (card: PieceCardLayout, pointerId: number, pointerWorld: b2Vec2) => {
  placement = {
    template: card.template,
    position: pointerWorld,
    angle: 0,
    activePointerId: pointerId,
    pointerOffset: new b2Vec2(0, 0),
  };
};

const tryStartGesture = () => {
  if (!placement || activePointers.size < 2) {
    return;
  }

  const entries = [...activePointers.entries()];
  const [pointerA, pointA] = entries[0];
  const [pointerB, pointB] = entries[1];

  const mid = new b2Vec2((pointA.x + pointB.x) / 2, (pointA.y + pointB.y) / 2);
  const angle = Math.atan2(pointB.y - pointA.y, pointB.x - pointA.x);
  const distance = Math.hypot(pointB.x - pointA.x, pointB.y - pointA.y);

  gesture = {
    pointerA,
    pointerB,
    initialMid: mid,
    initialAngle: angle,
    initialDistance: Math.max(distance, 0.001),
    pieceInitialPosition: new b2Vec2(placement.position.x, placement.position.y),
    pieceInitialAngle: placement.angle,
  };
};

const updatePlacementFromPointers = () => {
  if (!placement) {
    return;
  }

  if (gesture) {
    const pointA = activePointers.get(gesture.pointerA);
    const pointB = activePointers.get(gesture.pointerB);
    if (!pointA || !pointB) {
      gesture = undefined;
      return;
    }

    const currentMid = new b2Vec2((pointA.x + pointB.x) / 2, (pointA.y + pointB.y) / 2);
    const currentAngle = Math.atan2(pointB.y - pointA.y, pointB.x - pointA.x);
    const angleDelta = currentAngle - gesture.initialAngle;

    placement.position = new b2Vec2(
      gesture.pieceInitialPosition.x + (currentMid.x - gesture.initialMid.x),
      gesture.pieceInitialPosition.y + (currentMid.y - gesture.initialMid.y),
    );
    placement.angle = gesture.pieceInitialAngle + angleDelta;
    return;
  }

  if (placement.activePointerId !== null) {
    const pointerPoint = activePointers.get(placement.activePointerId);
    if (!pointerPoint) {
      return;
    }
    placement.position = new b2Vec2(pointerPoint.x - placement.pointerOffset.x, pointerPoint.y - placement.pointerOffset.y);
  }
};

canvas.addEventListener('pointerdown', (event) => {
  const x = event.clientX;
  const y = event.clientY;
  const worldPoint = toWorldFromCanvas(x, y);

  activePointers.set(event.pointerId, worldPoint);

  if (inRect(x, y, applyButtonRect) && placement) {
    spawnPlacedShape(placement.template, placement.position, placement.angle);
    placement = undefined;
    gesture = undefined;
    activePointers.clear();
    refillPalette();
    rebuildMenuLayout();
    render();
    return;
  }

  if (!placement) {
    const card = cardAtPoint(x, y);
    if (!card) {
      return;
    }

    beginPlacementFromCard(card, event.pointerId, worldPoint);
    canvas.setPointerCapture(event.pointerId);
    return;
  }

  if (placement.activePointerId === null) {
    placement.activePointerId = event.pointerId;
    placement.pointerOffset = new b2Vec2(worldPoint.x - placement.position.x, worldPoint.y - placement.position.y);
  }

  if (activePointers.size >= 2) {
    placement.activePointerId = null;
    tryStartGesture();
  }

  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener('pointermove', (event) => {
  if (!activePointers.has(event.pointerId)) {
    return;
  }

  activePointers.set(event.pointerId, toWorldFromCanvas(event.clientX, event.clientY));
  updatePlacementFromPointers();
});

const releasePointer = (pointerId: number) => {
  activePointers.delete(pointerId);

  if (!placement) {
    gesture = undefined;
    return;
  }

  if (gesture && (gesture.pointerA === pointerId || gesture.pointerB === pointerId)) {
    gesture = undefined;

    const remaining = [...activePointers.keys()][0];
    if (remaining !== undefined) {
      placement.activePointerId = remaining;
      const point = activePointers.get(remaining);
      if (point) {
        placement.pointerOffset = new b2Vec2(point.x - placement.position.x, point.y - placement.position.y);
      }
    } else {
      placement.activePointerId = null;
    }
  } else if (placement.activePointerId === pointerId) {
    placement.activePointerId = null;
  }

  if (!gesture && activePointers.size >= 2) {
    placement.activePointerId = null;
    tryStartGesture();
  }
};

canvas.addEventListener('pointerup', (event) => {
  releasePointer(event.pointerId);
});

canvas.addEventListener('pointercancel', (event) => {
  releasePointer(event.pointerId);
});

const tick = () => {
  if (!placement) {
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

refillPalette();
resize();
requestAnimationFrame(tick);
