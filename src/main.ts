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

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('Missing #app container');
}

const canvas = document.createElement('canvas');
const context = canvas.getContext('2d');
if (!context) {
  throw new Error('Canvas 2D context unavailable');
}

app.append(canvas);

const world = b2World.Create(new b2Vec2(0, 10));
const circles: { body: ReturnType<typeof world.CreateBody>; radius: number; color: string }[] = [];

const floorShape = new b2PolygonShape().SetAsBox(200, 0.5, { x: 0, y: 22 }, 0);
world
  .CreateBody({ type: b2BodyType.b2_staticBody })
  .CreateFixture({ shape: floorShape, friction: 0.7 });

const wallThickness = 0.5;
world
  .CreateBody({ type: b2BodyType.b2_staticBody })
  .CreateFixture({
    shape: new b2PolygonShape().SetAsBox(wallThickness, 100, { x: -15, y: 0 }, 0),
  });
world
  .CreateBody({ type: b2BodyType.b2_staticBody })
  .CreateFixture({
    shape: new b2PolygonShape().SetAsBox(wallThickness, 100, { x: 15, y: 0 }, 0),
  });

const resize = () => {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
};

window.addEventListener('resize', resize);
resize();

const randomColor = () => `hsl(${Math.floor(Math.random() * 360)} 90% 65%)`;

const spawnCircle = () => {
  const radius = 0.25 + Math.random() * 0.45;
  const body = world.CreateBody({
    type: b2BodyType.b2_dynamicBody,
    position: { x: -8 + Math.random() * 16, y: -2 },
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
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#0b1020';
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.save();
  context.translate(canvas.width / 2, 80);

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
  context.fillText(`Circles: ${circles.length}`, 20, 56);
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
