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
const APPLY_BUTTON_SIZE_PX = 64;

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
  id: string;
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
  draftId: string;
};

type GestureState = {
  target: SelectedObject;
  pointerA: number;
  pointerB: number;
  initialAngle: number;
  objectInitialPosition: b2Vec2;
  objectInitialAngle: number;
};

type WorldManipulationState = {
  shape: FallingShape;
  activePointerId: number | null;
  pointerOffset: b2Vec2;
};

type SelectedObject =
  | { kind: 'placement'; id: string }
  | { kind: 'draft'; id: string }
  | { kind: 'world'; id: string };

type DraftPiece = {
  id: string;
  template: PieceTemplate;
  position: b2Vec2;
  angle: number;
};

type PieceCardLayout = {
  template: PieceTemplate | undefined;
  x: number;
  y: number;
  width: number;
  height: number;
  index: number;
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
let palette: Array<PieceTemplate | undefined> = [];
let paletteCards: PieceCardLayout[] = [];
let applyButtonRect = { x: 0, y: 0, width: APPLY_BUTTON_SIZE_PX, height: APPLY_BUTTON_SIZE_PX };
let placement: PlacementState | undefined;
let worldManipulation: WorldManipulationState | undefined;
let gesture: GestureState | undefined;
let drafts: DraftPiece[] = [];
let selectedObject: SelectedObject | undefined;
let pieceCounter = 0;
let draftCounter = 0;
let worldShapeCounter = 0;

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

const transformedVertices = (vertices: b2Vec2[], position: b2Vec2, angle: number) => {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return vertices.map((vertex) => new b2Vec2(
    position.x + cos * vertex.x - sin * vertex.y,
    position.y + sin * vertex.x + cos * vertex.y,
  ));
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

const scaleVertices = (vertices: b2Vec2[], scaleX: number, scaleY: number) => vertices.map((vertex) => new b2Vec2(vertex.x * scaleX, vertex.y * scaleY));

const normalizeVerticesArea = (vertices: b2Vec2[], targetArea: number) => {
  const area = getPolygonArea(vertices);
  if (area <= 0.0001) {
    return vertices;
  }

  const scale = Math.sqrt(targetArea / area);
  return scaleVertices(vertices, scale, scale);
};

const createLongOrganicShape = () => {
  const length = 2.2 + Math.random() * 1.5;
  const thickness = 0.35 + Math.random() * 0.45;
  const halfLength = length / 2;
  const topTilt = 0.08 + Math.random() * 0.25;
  const bottomTilt = 0.1 + Math.random() * 0.22;

  return [
    new b2Vec2(-halfLength * (0.98 + Math.random() * 0.12), -thickness * (0.58 + Math.random() * 0.28)),
    new b2Vec2(-halfLength * (0.35 + Math.random() * 0.2), -thickness * (1.0 + topTilt)),
    new b2Vec2(halfLength * (0.35 + Math.random() * 0.2), -thickness * (0.82 + Math.random() * 0.24)),
    new b2Vec2(halfLength * (0.96 + Math.random() * 0.1), -thickness * (0.1 + Math.random() * 0.24)),
    new b2Vec2(halfLength * (0.72 + Math.random() * 0.18), thickness * (0.7 + bottomTilt)),
    new b2Vec2(-halfLength * (0.12 + Math.random() * 0.25), thickness * (1.0 + Math.random() * 0.2)),
    new b2Vec2(-halfLength * (0.94 + Math.random() * 0.12), thickness * (0.58 + Math.random() * 0.28)),
  ];
};

const createSquarishOrganicShape = () => {
  const width = 1.25 + Math.random() * 1.1;
  const height = 0.82 + Math.random() * 0.8;
  const hw = width / 2;
  const hh = height / 2;

  return [
    new b2Vec2(-hw * (0.95 + Math.random() * 0.14), -hh * (0.72 + Math.random() * 0.24)),
    new b2Vec2(-hw * (0.15 + Math.random() * 0.25), -hh * (1.0 + Math.random() * 0.22)),
    new b2Vec2(hw * (0.72 + Math.random() * 0.22), -hh * (0.84 + Math.random() * 0.24)),
    new b2Vec2(hw * (1.0 + Math.random() * 0.12), -hh * (0.08 + Math.random() * 0.24)),
    new b2Vec2(hw * (0.7 + Math.random() * 0.24), hh * (0.75 + Math.random() * 0.24)),
    new b2Vec2(hw * (0.08 + Math.random() * 0.24), hh * (1.0 + Math.random() * 0.2)),
    new b2Vec2(-hw * (0.82 + Math.random() * 0.18), hh * (0.78 + Math.random() * 0.24)),
    new b2Vec2(-hw * (1.0 + Math.random() * 0.12), hh * (0.08 + Math.random() * 0.24)),
  ];
};

const createRoundedTriShape = () => {
  const width = 1.3 + Math.random() * 1.3;
  const height = 1.0 + Math.random() * 1.2;
  const hw = width / 2;
  const hh = height / 2;

  return [
    new b2Vec2(-hw * (0.96 + Math.random() * 0.14), hh * (0.6 + Math.random() * 0.26)),
    new b2Vec2(-hw * (0.45 + Math.random() * 0.28), -hh * (0.84 + Math.random() * 0.24)),
    new b2Vec2(hw * (0.12 + Math.random() * 0.28), -hh * (1.0 + Math.random() * 0.22)),
    new b2Vec2(hw * (0.68 + Math.random() * 0.2), -hh * (0.5 + Math.random() * 0.22)),
    new b2Vec2(hw * (1.0 + Math.random() * 0.1), hh * (0.15 + Math.random() * 0.32)),
    new b2Vec2(hw * (0.54 + Math.random() * 0.24), hh * (0.8 + Math.random() * 0.2)),
    new b2Vec2(-hw * (0.08 + Math.random() * 0.26), hh * (1.0 + Math.random() * 0.2)),
  ];
};

const createTemplate = (): PieceTemplate => {
  pieceCounter += 1;
  const shapeBuilders = [createLongOrganicShape, createSquarishOrganicShape, createSquarishOrganicShape, createRoundedTriShape];
  const chosenShape = shapeBuilders[Math.floor(Math.random() * shapeBuilders.length)]();
  const normalizedVertices = normalizeVerticesArea(chosenShape, 1.35 + Math.random() * 0.22);
  return {
    id: `piece-${pieceCounter}`,
    vertices: normalizedVertices,
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

  applyButtonRect = {
    x: MENU_PADDING_PX,
    y: menuTop + Math.round((MENU_HEIGHT_PX - APPLY_BUTTON_SIZE_PX) / 2),
    width: APPLY_BUTTON_SIZE_PX,
    height: APPLY_BUTTON_SIZE_PX,
  };

  const cardsStartX = applyButtonRect.x + applyButtonRect.width + MENU_GAP_PX;
  const cardsAvailableWidth = Math.max(160, canvasWidth - cardsStartX - MENU_PADDING_PX - MENU_GAP_PX * 2);
  const cardWidth = cardsAvailableWidth / 3;
  const cardHeight = MENU_HEIGHT_PX - MENU_PADDING_PX * 2;

  paletteCards = palette.map((template, index) => ({
    template,
    x: cardsStartX + index * (cardWidth + MENU_GAP_PX),
    y: menuTop + MENU_PADDING_PX,
    width: cardWidth,
    height: cardHeight,
    index,
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

  worldShapeCounter += 1;

  shapes.push({
    id: `world-shape-${worldShapeCounter}`,
    body,
    color: template.color,
    vertices: template.vertices,
  });
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

    if (selectedObject?.kind === 'world' && selectedObject.id === shape.id) {
      context.strokeStyle = '#ffffff';
      context.lineWidth = 3;
      drawPolygon(worldVertices);
      context.stroke();
    }
  }

  for (const draft of drafts) {
    const previewVertices = transformedVertices(draft.template.vertices, draft.position, draft.angle);
    context.fillStyle = `${draft.template.color}cc`;
    drawPolygon(previewVertices);
    context.fill();

    context.strokeStyle = '#ffffff88';
    context.lineWidth = 2;
    drawPolygon(previewVertices);
    context.stroke();

    if (selectedObject?.kind === 'draft' && selectedObject.id === draft.id) {
      context.strokeStyle = '#fff';
      context.lineWidth = 4;
      drawPolygon(previewVertices);
      context.stroke();
    }
  }

  if (placement) {
    const previewVertices = transformedVertices(placement.template.vertices, placement.position, placement.angle);
    context.fillStyle = `${placement.template.color}cc`;
    drawPolygon(previewVertices);
    context.fill();

    context.strokeStyle = '#ffffffcc';
    context.lineWidth = 2;
    drawPolygon(previewVertices);
    context.stroke();

    if (selectedObject?.kind === 'placement' && selectedObject.id === placement.draftId) {
      context.strokeStyle = '#fff';
      context.lineWidth = 4;
      drawPolygon(previewVertices);
      context.stroke();
    }
  }

  context.strokeStyle = '#8fa5ff88';
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(-worldHalfWidth * PHYSICS_SCALE, 0);
  context.lineTo(-worldHalfWidth * PHYSICS_SCALE, worldPixelHeight);
  context.moveTo(worldHalfWidth * PHYSICS_SCALE, 0);
  context.lineTo(worldHalfWidth * PHYSICS_SCALE, worldPixelHeight);
  context.stroke();

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

  const canApply = Boolean(placement) || drafts.length > 0;
  context.fillStyle = canApply ? '#2dbf6e' : '#4c5a76';
  context.beginPath();
  context.arc(
    applyButtonRect.x + applyButtonRect.width / 2,
    applyButtonRect.y + applyButtonRect.height / 2,
    applyButtonRect.width / 2,
    0,
    Math.PI * 2,
  );
  context.fill();

  context.fillStyle = 'white';
  context.beginPath();
  const cx = applyButtonRect.x + applyButtonRect.width / 2;
  const cy = applyButtonRect.y + applyButtonRect.height / 2;
  const iconSize = applyButtonRect.width * 0.34;
  context.moveTo(cx - iconSize * 0.45, cy - iconSize * 0.85);
  context.lineTo(cx - iconSize * 0.45, cy + iconSize * 0.85);
  context.lineTo(cx + iconSize * 0.95, cy);
  context.closePath();
  context.fill();

  for (const card of paletteCards) {
    context.fillStyle = '#1b2540';
    context.fillRect(card.x, card.y, card.width, card.height);

    context.strokeStyle = '#334470';
    context.lineWidth = 2;
    context.strokeRect(card.x, card.y, card.width, card.height);

    if (!card.template) {
      continue;
    }

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
};

const render = () => {
  context.clearRect(0, 0, canvasWidth, canvasHeight);
  renderWorld();
  renderMenu();
};

const cardAtPoint = (x: number, y: number) => paletteCards.find((card) => x >= card.x && x <= card.x + card.width && y >= card.y && y <= card.y + card.height);

const inRect = (x: number, y: number, rect: { x: number; y: number; width: number; height: number }) => x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;

const draftAtPoint = (point: b2Vec2) => {
  for (let i = drafts.length - 1; i >= 0; i -= 1) {
    const draft = drafts[i];
    const vertices = transformedVertices(draft.template.vertices, draft.position, draft.angle);
    if (isPointInPolygon(point, vertices)) {
      return draft;
    }
  }

  return undefined;
};

const worldShapeAtPoint = (point: b2Vec2) => {
  for (let i = shapes.length - 1; i >= 0; i -= 1) {
    const shape = shapes[i];
    const vertices = transformedVertices(shape.vertices, shape.body.GetPosition(), shape.body.GetAngle());
    if (isPointInPolygon(point, vertices)) {
      return shape;
    }
  }

  return undefined;
};

const beginPlacement = (template: PieceTemplate, pointerId: number, pointerWorld: b2Vec2, pointerOffset: b2Vec2, angle = 0, draftId?: string) => {
  if (!draftId) {
    draftCounter += 1;
  }

  placement = {
    template,
    position: new b2Vec2(pointerWorld.x - pointerOffset.x, pointerWorld.y - pointerOffset.y),
    angle,
    activePointerId: pointerId,
    pointerOffset,
    draftId: draftId ?? `draft-${draftCounter}`,
  };
  selectedObject = { kind: 'placement', id: placement.draftId };
};

const commitActivePlacementToDraft = () => {
  if (!placement) {
    return;
  }

  const draftId = placement.draftId;

  drafts.push({
    id: draftId,
    template: placement.template,
    position: placement.position,
    angle: placement.angle,
  });

  placement = undefined;
  gesture = undefined;
  selectedObject = { kind: 'draft', id: draftId };
};

const beginWorldManipulation = (shape: FallingShape, pointerId: number, pointerWorld: b2Vec2) => {
  const shapePosition = shape.body.GetPosition();
  shape.body.SetAwake(true);
  shape.body.SetLinearVelocity(new b2Vec2(0, 0));
  shape.body.SetAngularVelocity(0);

  worldManipulation = {
    shape,
    activePointerId: pointerId,
    pointerOffset: new b2Vec2(pointerWorld.x - shapePosition.x, pointerWorld.y - shapePosition.y),
  };
  selectedObject = { kind: 'world', id: shape.id };
};

const beginSelectedObjectManipulation = (pointerId: number, pointerWorld: b2Vec2) => {
  if (!selectedObject) {
    return false;
  }

  if (selectedObject.kind === 'world') {
    const shape = shapes.find((candidate) => candidate.id === selectedObject!.id);
    if (!shape) {
      return false;
    }

    beginWorldManipulation(shape, pointerId, pointerWorld);
    return true;
  }

  if (selectedObject.kind === 'draft') {
    const selectedDraft = drafts.find((candidate) => candidate.id === selectedObject!.id);
    if (!selectedDraft) {
      return false;
    }

    drafts = drafts.filter((draft) => draft.id !== selectedDraft.id);
    beginPlacement(
      selectedDraft.template,
      pointerId,
      pointerWorld,
      new b2Vec2(pointerWorld.x - selectedDraft.position.x, pointerWorld.y - selectedDraft.position.y),
      selectedDraft.angle,
      selectedDraft.id,
    );
    return true;
  }

  if (selectedObject.kind === 'placement' && placement && placement.draftId === selectedObject.id) {
    placement.activePointerId = pointerId;
    placement.pointerOffset = new b2Vec2(pointerWorld.x - placement.position.x, pointerWorld.y - placement.position.y);
    return true;
  }

  return false;
};

type TransformTarget = {
  selected: SelectedObject;
  getPosition: () => b2Vec2;
  getAngle: () => number;
  setPosition: (position: b2Vec2) => void;
  setAngle: (angle: number) => void;
  activePointerId: number | null;
  pointerOffset: b2Vec2;
  setActivePointerId: (pointerId: number | null) => void;
  setPointerOffset: (offset: b2Vec2) => void;
};

const currentManipulationTarget = (): TransformTarget | undefined => {
  if (placement) {
    return {
      selected: { kind: 'placement', id: placement.draftId },
      getPosition: () => placement!.position,
      getAngle: () => placement!.angle,
      setPosition: (position: b2Vec2) => {
        placement!.position = position;
      },
      setAngle: (angle: number) => {
        placement!.angle = angle;
      },
      activePointerId: placement.activePointerId,
      pointerOffset: placement.pointerOffset,
      setActivePointerId: (pointerId: number | null) => {
        placement!.activePointerId = pointerId;
      },
      setPointerOffset: (offset: b2Vec2) => {
        placement!.pointerOffset = offset;
      },
    };
  }

  if (worldManipulation) {
    return {
      selected: { kind: 'world', id: worldManipulation.shape.id },
      getPosition: () => worldManipulation!.shape.body.GetPosition(),
      getAngle: () => worldManipulation!.shape.body.GetAngle(),
      setPosition: (position: b2Vec2) => {
        worldManipulation!.shape.body.SetTransformVec(position, worldManipulation!.shape.body.GetAngle());
      },
      setAngle: (angle: number) => {
        worldManipulation!.shape.body.SetTransformVec(worldManipulation!.shape.body.GetPosition(), angle);
      },
      activePointerId: worldManipulation.activePointerId,
      pointerOffset: worldManipulation.pointerOffset,
      setActivePointerId: (pointerId: number | null) => {
        worldManipulation!.activePointerId = pointerId;
      },
      setPointerOffset: (offset: b2Vec2) => {
        worldManipulation!.pointerOffset = offset;
      },
    };
  }

  return undefined;
};

const selectedTarget = (): TransformTarget | undefined => {
  const selected = selectedObject;
  if (!selected) {
    return undefined;
  }

  if (selected.kind === 'placement') {
    if (!placement || placement.draftId !== selected.id) {
      return undefined;
    }

    const currentPlacement = placement;

    return {
      selected,
      getPosition: () => currentPlacement.position,
      getAngle: () => currentPlacement.angle,
      setPosition: (position: b2Vec2) => {
        currentPlacement.position = position;
      },
      setAngle: (angle: number) => {
        currentPlacement.angle = angle;
      },
      activePointerId: currentPlacement.activePointerId,
      pointerOffset: currentPlacement.pointerOffset,
      setActivePointerId: (pointerId: number | null) => {
        currentPlacement.activePointerId = pointerId;
      },
      setPointerOffset: (offset: b2Vec2) => {
        currentPlacement.pointerOffset = offset;
      },
    };
  }

  if (selected.kind === 'draft') {
    const draft = drafts.find((candidate) => candidate.id === selected.id);
    if (!draft) {
      return undefined;
    }

    return {
      selected,
      getPosition: () => draft.position,
      getAngle: () => draft.angle,
      setPosition: (position: b2Vec2) => {
        draft.position = position;
      },
      setAngle: (angle: number) => {
        draft.angle = angle;
      },
      activePointerId: null,
      pointerOffset: new b2Vec2(0, 0),
      setActivePointerId: () => undefined,
      setPointerOffset: () => undefined,
    };
  }

  const shape = shapes.find((candidate) => candidate.id === selected.id);
  if (!shape) {
    return undefined;
  }

  return {
    selected,
    getPosition: () => shape.body.GetPosition(),
    getAngle: () => shape.body.GetAngle(),
    setPosition: (position: b2Vec2) => {
      shape.body.SetTransformVec(position, shape.body.GetAngle());
    },
    setAngle: (angle: number) => {
      shape.body.SetTransformVec(shape.body.GetPosition(), angle);
    },
    activePointerId: null,
    pointerOffset: new b2Vec2(0, 0),
    setActivePointerId: () => undefined,
    setPointerOffset: () => undefined,
  };
};

const tryStartGesture = () => {
  if (activePointers.size < 2) {
    return;
  }

  const target = currentManipulationTarget() ?? selectedTarget();
  if (!target) {
    return;
  }

  const entries = [...activePointers.entries()];
  const [pointerA, pointA] = entries[0];
  const [pointerB, pointB] = entries[1];

  gesture = {
    target: target.selected,
    pointerA,
    pointerB,
    initialAngle: Math.atan2(pointB.y - pointA.y, pointB.x - pointA.x),
    objectInitialPosition: target.getPosition(),
    objectInitialAngle: target.getAngle(),
  };
};

const updatePlacementFromPointers = () => {
  const manipulationTarget = currentManipulationTarget();

  if (gesture) {
    const gestureTarget = selectedTarget();
    const pointA = activePointers.get(gesture.pointerA);
    const pointB = activePointers.get(gesture.pointerB);
    if (!gestureTarget || !pointA || !pointB || gestureTarget.selected.kind !== gesture.target.kind || gestureTarget.selected.id !== gesture.target.id) {
      gesture = undefined;
      return;
    }

    const currentAngle = Math.atan2(pointB.y - pointA.y, pointB.x - pointA.x);
    const angleDelta = currentAngle - gesture.initialAngle;

    gestureTarget.setPosition(gesture.objectInitialPosition);
    gestureTarget.setAngle(gesture.objectInitialAngle + angleDelta);
    return;
  }

  if (!manipulationTarget || manipulationTarget.activePointerId === null) {
    return;
  }

  const pointerPoint = activePointers.get(manipulationTarget.activePointerId);
  if (!pointerPoint) {
    return;
  }

  manipulationTarget.setPosition(new b2Vec2(pointerPoint.x - manipulationTarget.pointerOffset.x, pointerPoint.y - manipulationTarget.pointerOffset.y));
};

const applyDrafts = () => {
  if (placement) {
    commitActivePlacementToDraft();
  }

  if (drafts.length === 0) {
    return;
  }

  for (const draft of drafts) {
    spawnPlacedShape(draft.template, draft.position, draft.angle);
  }

  drafts = [];
  selectedObject = undefined;
  refillPalette();
  rebuildMenuLayout();
};

canvas.addEventListener('pointerdown', (event) => {
  const x = event.clientX;
  const y = event.clientY;
  const worldPoint = toWorldFromCanvas(x, y);

  if (inRect(x, y, applyButtonRect)) {
    applyDrafts();
    activePointers.clear();
    gesture = undefined;
    render();
    return;
  }

  activePointers.set(event.pointerId, worldPoint);

  if (!placement && !worldManipulation) {
    const card = cardAtPoint(x, y);
    if (card?.template) {
      beginPlacement(card.template, event.pointerId, worldPoint, new b2Vec2(0, 0));
      palette[card.index] = undefined;
      rebuildMenuLayout();
      canvas.setPointerCapture(event.pointerId);
      return;
    }

    const existingDraft = draftAtPoint(worldPoint);
    if (existingDraft) {
      drafts = drafts.filter((draft) => draft.id !== existingDraft.id);
      beginPlacement(
        existingDraft.template,
        event.pointerId,
        worldPoint,
        new b2Vec2(worldPoint.x - existingDraft.position.x, worldPoint.y - existingDraft.position.y),
        existingDraft.angle,
        existingDraft.id,
      );
      canvas.setPointerCapture(event.pointerId);
      return;
    }

    const existingShape = worldShapeAtPoint(worldPoint);
    if (existingShape) {
      beginWorldManipulation(existingShape, event.pointerId, worldPoint);
      canvas.setPointerCapture(event.pointerId);
      return;
    }

    if (beginSelectedObjectManipulation(event.pointerId, worldPoint)) {
      canvas.setPointerCapture(event.pointerId);
      return;
    }
  }

  const manipulationTarget = currentManipulationTarget();
  if (manipulationTarget?.activePointerId === null) {
    manipulationTarget.setActivePointerId(event.pointerId);
    const position = manipulationTarget.getPosition();
    manipulationTarget.setPointerOffset(new b2Vec2(worldPoint.x - position.x, worldPoint.y - position.y));
  }

  if (activePointers.size >= 2) {
    if (manipulationTarget) {
      manipulationTarget.setActivePointerId(null);
    }
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

  const manipulationTarget = currentManipulationTarget();

  if (gesture && (gesture.pointerA === pointerId || gesture.pointerB === pointerId)) {
    gesture = undefined;
  }

  if (manipulationTarget) {
    if (manipulationTarget.activePointerId === pointerId) {
      manipulationTarget.setActivePointerId(null);
    }

    const remaining = [...activePointers.keys()][0];
    if (manipulationTarget.activePointerId === null && remaining !== undefined) {
      manipulationTarget.setActivePointerId(remaining);
      const point = activePointers.get(remaining);
      if (point) {
        const position = manipulationTarget.getPosition();
        manipulationTarget.setPointerOffset(new b2Vec2(point.x - position.x, point.y - position.y));
      }
    }
  }

  if (!gesture && activePointers.size >= 2) {
    if (manipulationTarget) {
      manipulationTarget.setActivePointerId(null);
    }
    tryStartGesture();
  }

  if (activePointers.size === 0) {
    if (placement) {
      commitActivePlacementToDraft();
    }
    worldManipulation = undefined;
  }
};

canvas.addEventListener('pointerup', (event) => {
  releasePointer(event.pointerId);
});

canvas.addEventListener('pointercancel', (event) => {
  releasePointer(event.pointerId);
});

const tick = () => {
  const physicsPaused = Boolean(placement) || Boolean(worldManipulation) || Boolean(gesture) || drafts.length > 0;
  if (!physicsPaused) {
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
