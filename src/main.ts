import {
  b2BodyType,
  b2CircleShape,
  b2PolygonShape,
  b2Vec2,
  b2World,
} from '@box2d/core';

const PHYSICS_SCALE = 30;
const TIME_STEP = 1 / 60;
const STEP_CONFIG = { velocityIterations: 8, positionIterations: 3 } as const;
const SPAWN_INTERVAL_MS = 500;
const MAX_DEVICE_PIXEL_RATIO = 2;
const MIN_WORLD_WIDTH_METERS = 12;
const SIDE_PADDING_PX = 24;

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

const world = b2World.Create(new b2Vec2(0, 10));
const circles: { body: ReturnType<typeof world.CreateBody>; radius: number; color: string }[] = [];

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

const spawnCircle = () => {
  const radius = 0.25 + Math.random() * 0.45;
  const body = world.CreateBody({
    type: b2BodyType.b2_dynamicBody,
    position: { x: -worldHalfWidth * 0.7 + Math.random() * worldHalfWidth * 1.4, y: worldTopPadding },
    angularVelocity: Math.random() * 4 - 2,
  });

  body.CreateFixture({
    shape: new b2CircleShape(radius),
    density: 1,
    friction: 0.25,
    restitution: 0.4,
  });

  circles.push({ body, radius, color: randomColor() });
};

let previousSpawn = 0;

const render = () => {
  context.clearRect(0, 0, canvasWidth, canvasHeight);
  context.fillStyle = '#0b1020';
  context.fillRect(0, 0, canvasWidth, canvasHeight);

  context.save();
  context.translate(canvasWidth / 2, 0);

  for (const circle of circles) {
    const position = circle.body.GetPosition();
    const angle = circle.body.GetAngle();

    context.save();
    context.translate(position.x * PHYSICS_SCALE, position.y * PHYSICS_SCALE);
    context.rotate(angle);
    context.fillStyle = circle.color;
    context.beginPath();
    context.arc(0, 0, circle.radius * PHYSICS_SCALE, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  context.restore();

  context.fillStyle = 'white';
  context.font = '16px system-ui';
  context.fillText('Box2D + TypeScript playground', 20, 32);
};

const tick = (timestamp: number) => {
  if (!previousSpawn || timestamp - previousSpawn >= SPAWN_INTERVAL_MS) {
    previousSpawn = timestamp;
    spawnCircle();
  }

  world.Step(TIME_STEP, STEP_CONFIG);

  if (circles.length > 100) {
    const removed = circles.splice(0, circles.length - 100);
    for (const circle of removed) {
      world.DestroyBody(circle.body);
    }
  }

  render();
  requestAnimationFrame(tick);
};

requestAnimationFrame(tick);
