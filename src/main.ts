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
const SPAWN_INTERVAL_MS = 5_000;
const MAX_DEVICE_PIXEL_RATIO = 2;
const MIN_WORLD_WIDTH_METERS = 0;
const SIDE_PADDING_PX = 0;
const TARGET_SHAPE_MASS = 1;
const DRAG_FORCE_PER_METER = 8;
const MAX_DRAG_FORCE_GRAVITY_RATIO = 0.96;

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
console.log('Debug overlay initialized');

const world = b2World.Create(new b2Vec2(0, 10));
type FallingShape = {
  body: ReturnType<typeof world.CreateBody>;
  color: string;
  vertices: b2Vec2[];
};

type DragState = {
  pointerId: number;
  shape: FallingShape;
  localGrabPoint: b2Vec2;
  pointerWorld: b2Vec2;
};

const shapes: FallingShape[] = [];

let floorBody: ReturnType<typeof world.CreateBody> | undefined;
let leftWallBody: ReturnType<typeof world.CreateBody> | undefined;
let rightWallBody: ReturnType<typeof world.CreateBody> | undefined;
let canvasWidth = 0;
let canvasHeight = 0;
let worldHalfWidth = MIN_WORLD_WIDTH_METERS / 2;
let worldFloorY = 22;
let worldTopPadding = 2;
let dragState: DragState | undefined;

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
  const worldHeight = canvasHeight / PHYSICS_SCALE;
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
  canvas.width = Math.round(width * pixelRatio);
  canvas.height = Math.round(height * pixelRatio);
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  rebuildBounds();
};

window.addEventListener('resize', resize);
window.visualViewport?.addEventListener('resize', resize);
resize();

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

const toWorldFromCanvas = (x: number, y: number) => new b2Vec2((x - canvasWidth / 2) / PHYSICS_SCALE, y / PHYSICS_SCALE);

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

const isPointInPolygon = (point: b2Vec2, vertices: b2Vec2[]) => {
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i, i += 1) {
    const xi = vertices[i].x;
    const yi = vertices[i].y;
    const xj = vertices[j].x;
    const yj = vertices[j].y;

    const intersects = (yi > point.y) !== (yj > point.y)
      && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
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

const spawnShape = () => {
  const vertices = createOrganicLongShape();
  const body = world.CreateBody({
    type: b2BodyType.b2_dynamicBody,
    position: { x: -worldHalfWidth * 0.7 + Math.random() * worldHalfWidth * 1.4, y: worldTopPadding },
    angularVelocity: Math.random() * 2 - 1,
  });

  const shape = new b2PolygonShape();
  shape.Set(vertices, vertices.length);

  const polygonArea = getPolygonArea(vertices);
  const density = TARGET_SHAPE_MASS / Math.max(polygonArea, 0.01);

  body.CreateFixture({
    shape,
    density,
    friction: 0.55,
    restitution: 0.15,
  });

  shapes.push({ body, vertices, color: randomColor() });
};

const getTopmostShapeAtPoint = (worldPoint: b2Vec2) => {
  for (let i = shapes.length - 1; i >= 0; i -= 1) {
    const shape = shapes[i];
    const body = shape.body;
    const localPoint = toLocalFromBody(body.GetPosition(), body.GetAngle(), worldPoint);
    if (isPointInPolygon(localPoint, shape.vertices)) {
      return { shape, localPoint };
    }
  }

  return undefined;
};

const updateDragForce = () => {
  if (!dragState) {
    return;
  }

  const body = dragState.shape.body;
  const bodyPosition = body.GetPosition();
  const bodyAngle = body.GetAngle();
  const grabPointWorld = toWorldFromBody(bodyPosition, bodyAngle, dragState.localGrabPoint);

  const pullVector = new b2Vec2(
    dragState.pointerWorld.x - grabPointWorld.x,
    dragState.pointerWorld.y - grabPointWorld.y,
  );
  const pullDistance = Math.hypot(pullVector.x, pullVector.y);

  if (pullDistance <= 0.0001) {
    return;
  }

  const bodyMass = body.GetMass();
  const gravityMagnitude = Math.abs(world.GetGravity().y);
  const maxForce = bodyMass * gravityMagnitude * MAX_DRAG_FORCE_GRAVITY_RATIO;
  const requestedForce = pullDistance * DRAG_FORCE_PER_METER;
  const forceMagnitude = Math.min(requestedForce, maxForce);

  const normalizedX = pullVector.x / pullDistance;
  const normalizedY = pullVector.y / pullDistance;
  const force = new b2Vec2(normalizedX * forceMagnitude, normalizedY * forceMagnitude);

  body.ApplyForce(force, grabPointWorld, true);
};

canvas.addEventListener('pointerdown', (event) => {
  const worldPoint = toWorldFromCanvas(event.clientX, event.clientY);
  const hit = getTopmostShapeAtPoint(worldPoint);
  if (!hit) {
    return;
  }

  dragState = {
    pointerId: event.pointerId,
    shape: hit.shape,
    localGrabPoint: hit.localPoint,
    pointerWorld: worldPoint,
  };

  canvas.setPointerCapture(event.pointerId);
  hit.shape.body.SetAwake(true);
});

canvas.addEventListener('pointermove', (event) => {
  if (!dragState || dragState.pointerId !== event.pointerId) {
    return;
  }

  dragState.pointerWorld = toWorldFromCanvas(event.clientX, event.clientY);
});

const endDrag = (pointerId: number) => {
  if (!dragState || dragState.pointerId !== pointerId) {
    return;
  }

  dragState = undefined;
};

canvas.addEventListener('pointerup', (event) => {
  endDrag(event.pointerId);
});

canvas.addEventListener('pointercancel', (event) => {
  endDrag(event.pointerId);
});

let previousSpawn = 0;

const render = () => {
  context.clearRect(0, 0, canvasWidth, canvasHeight);
  context.fillStyle = '#0b1020';
  context.fillRect(0, 0, canvasWidth, canvasHeight);

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

  if (dragState) {
    const body = dragState.shape.body;
    const grabPointWorld = toWorldFromBody(body.GetPosition(), body.GetAngle(), dragState.localGrabPoint);

    context.strokeStyle = '#ffffffcc';
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(grabPointWorld.x * PHYSICS_SCALE, grabPointWorld.y * PHYSICS_SCALE);
    context.lineTo(dragState.pointerWorld.x * PHYSICS_SCALE, dragState.pointerWorld.y * PHYSICS_SCALE);
    context.stroke();
  }

  context.restore();
};

const tick = (timestamp: number) => {
  if (!previousSpawn || timestamp - previousSpawn >= SPAWN_INTERVAL_MS) {
    previousSpawn = timestamp;
    spawnShape();
  }

  updateDragForce();
  world.Step(TIME_STEP, STEP_CONFIG);

  if (shapes.length > 100) {
    const removed = shapes.splice(0, shapes.length - 100);
    for (const shape of removed) {
      if (dragState?.shape === shape) {
        dragState = undefined;
      }
      world.DestroyBody(shape.body);
    }
  }

  render();
  requestAnimationFrame(tick);
};

requestAnimationFrame(tick);
