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

app.append(canvas);

initDebugOverlay();
console.log('Debug overlay initialized');

const world = b2World.Create(new b2Vec2(0, 10));
type FallingShape = {
  body: ReturnType<typeof world.CreateBody>;
  color: string;
  vertices: b2Vec2[];
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

  body.CreateFixture({
    shape,
    density: 1,
    friction: 0.55,
    restitution: 0.15,
  });

  shapes.push({ body, vertices, color: randomColor() });
};

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

  context.restore();

};

const tick = (timestamp: number) => {
  if (!previousSpawn || timestamp - previousSpawn >= SPAWN_INTERVAL_MS) {
    previousSpawn = timestamp;
    spawnShape();
  }

  world.Step(TIME_STEP, STEP_CONFIG);

  if (shapes.length > 100) {
    const removed = shapes.splice(0, shapes.length - 100);
    for (const shape of removed) {
      world.DestroyBody(shape.body);
    }
  }

  render();
  requestAnimationFrame(tick);
};

requestAnimationFrame(tick);
