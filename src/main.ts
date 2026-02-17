import { initDebugOverlay } from './debugOverlay';
import { DEFAULT_TWIG_TUNING, Twig, type TwigTuning } from './physics/Twig';
import { buildTwigPreviewSegments, drawTwig, drawTwigPreview, pruneTwigRenderCache } from './render/twigRender';

import {
  b2BodyType,
  b2PolygonShape,
  b2Vec2,
  b2World,
} from '@box2d/core';

const PHYSICS_SCALE = 30;
const TIME_STEP = 1 / 60;
const STEP_CONFIG = { velocityIterations: 12, positionIterations: 8 } as const;
const TWIG_PHYSICS_SUBSTEPS = 3;
const MAX_DEVICE_PIXEL_RATIO = 2;
const MIN_WORLD_WIDTH_METERS = 0;
const SIDE_PADDING_PX = 0;
const TARGET_SHAPE_MASS = 1;
const MENU_HEIGHT_PX = 160;
const MENU_PADDING_PX = 16;
const MENU_GAP_PX = 12;
const APPLY_BUTTON_SIZE_PX = 64;
const MENU_PREVIEW_WORLD_SCALE = 1;
const WHEEL_ROTATION_RADIANS_PER_DELTA_Y = Math.PI / 5400;
const MAX_WHEEL_ROTATION_STEP_RAD = Math.PI / 60;
const TWIG_TEMPLATE_TARGET_INTERVAL = 5;
const TWIG_TEMPLATE_INTERVAL_VARIANCE = 0;
const WORLD_OBJECT_LIMIT = 100;
const TWIG_DEFAULT_SEGMENT_COUNT = 6;
const TWIG_DEFAULT_LENGTH = 4.9;
const TWIG_DEFAULT_THICKNESS = 0.26;
const TWIG_COLOR = '#c98a54';

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

app.append(canvas);

initDebugOverlay();

const world = b2World.Create(new b2Vec2(0, 10));
type FallingShape = {
  kind: 'rigid';
  id: string;
  body: ReturnType<typeof world.CreateBody>;
  color: string;
  vertices: b2Vec2[];
};

type TwigWorldObject = {
  kind: 'twig';
  id: string;
  twig: Twig;
  color: string;
  length: number;
  thickness: number;
  segmentCount: number;
  tuning: TwigTuning;
};

type RigidPieceTemplate = {
  kind: 'rigid';
  id: string;
  vertices: b2Vec2[];
  color: string;
};

type TwigPieceTemplate = {
  kind: 'twig';
  id: string;
  color: string;
  length: number;
  thickness: number;
  segmentCount: number;
  tuning: TwigTuning;
};

type PieceTemplate = RigidPieceTemplate | TwigPieceTemplate;

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
  shape: FallingShape | TwigWorldObject;
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

type SnapshotShape = {
  kind: 'rigid';
  id: string;
  color: string;
  vertices: b2Vec2[];
  position: b2Vec2;
  angle: number;
  linearVelocity: b2Vec2;
  angularVelocity: number;
};

type SnapshotTwigSegment = {
  position: b2Vec2;
  angle: number;
  linearVelocity: b2Vec2;
  angularVelocity: number;
};

type SnapshotTwig = {
  kind: 'twig';
  id: string;
  color: string;
  length: number;
  thickness: number;
  segmentCount: number;
  tuning: TwigTuning;
  segments: SnapshotTwigSegment[];
};

type SnapshotWorldObject = SnapshotShape | SnapshotTwig;

type WorldObjectRef =
  | { kind: 'rigid'; id: string }
  | { kind: 'twig'; id: string };

type UndoSnapshot = {
  worldObjects: SnapshotWorldObject[];
  drafts: DraftPiece[];
  palette: Array<PieceTemplate | undefined>;
  selectedObject: SelectedObject | undefined;
  worldShapeCounter: number;
  draftCounter: number;
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
const twigs: TwigWorldObject[] = [];
const worldObjectOrder: WorldObjectRef[] = [];
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
let randomizedTemplateCounter = 0;
let nextTwigTemplateAt = 0;
let undoSnapshot: UndoSnapshot | undefined;

const TWIG_TUNING = {
  segmentCount: TWIG_DEFAULT_SEGMENT_COUNT,
  angleLimitDeg: DEFAULT_TWIG_TUNING.angleLimitDeg,
  weldStiffness: DEFAULT_TWIG_TUNING.weldStiffness,
  weldDamping: DEFAULT_TWIG_TUNING.weldDamping,
  angularDamping: DEFAULT_TWIG_TUNING.angularDamping,
  densityMultiplier: DEFAULT_TWIG_TUNING.densityMultiplier,
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const tuningButton = document.createElement('button');
tuningButton.type = 'button';
tuningButton.textContent = 'Twig Tuning';
tuningButton.style.position = 'absolute';
tuningButton.style.top = '16px';
tuningButton.style.right = '16px';
tuningButton.style.zIndex = '20';
tuningButton.style.border = '1px solid #3b4e7f';
tuningButton.style.background = '#151f35';
tuningButton.style.color = '#f4f7ff';
tuningButton.style.borderRadius = '10px';
tuningButton.style.padding = '10px 14px';
tuningButton.style.font = '600 14px system-ui, -apple-system, Segoe UI, sans-serif';
tuningButton.style.cursor = 'pointer';
tuningButton.style.boxShadow = '0 6px 16px rgba(0,0,0,0.28)';

const tuningPanel = document.createElement('div');
tuningPanel.style.position = 'absolute';
tuningPanel.style.top = '62px';
tuningPanel.style.right = '16px';
tuningPanel.style.zIndex = '21';
tuningPanel.style.width = '280px';
tuningPanel.style.maxWidth = 'calc(100vw - 24px)';
tuningPanel.style.border = '1px solid #3b4e7f';
tuningPanel.style.background = 'rgba(16, 24, 42, 0.95)';
tuningPanel.style.color = '#eef3ff';
tuningPanel.style.borderRadius = '12px';
tuningPanel.style.padding = '12px';
tuningPanel.style.backdropFilter = 'blur(4px)';
tuningPanel.style.boxShadow = '0 10px 26px rgba(0,0,0,0.35)';
tuningPanel.style.display = 'none';
tuningPanel.style.userSelect = 'none';
tuningPanel.style.font = '500 13px system-ui, -apple-system, Segoe UI, sans-serif';

const panelHeader = document.createElement('div');
panelHeader.style.display = 'flex';
panelHeader.style.alignItems = 'center';
panelHeader.style.justifyContent = 'space-between';
panelHeader.style.marginBottom = '10px';

const panelTitle = document.createElement('strong');
panelTitle.textContent = 'Twig Tuning';
panelTitle.style.fontSize = '14px';
panelTitle.style.letterSpacing = '0.01em';

const closeButton = document.createElement('button');
closeButton.type = 'button';
closeButton.textContent = 'Close';
closeButton.style.border = '1px solid #4c5f92';
closeButton.style.background = '#202d4d';
closeButton.style.color = '#f2f6ff';
closeButton.style.borderRadius = '8px';
closeButton.style.padding = '4px 8px';
closeButton.style.font = '600 12px system-ui, -apple-system, Segoe UI, sans-serif';
closeButton.style.cursor = 'pointer';

panelHeader.append(panelTitle, closeButton);
tuningPanel.append(panelHeader);

type TuningControl = {
  input: HTMLInputElement;
  valueLabel: HTMLSpanElement;
  apply: (rawValue: number) => number;
  format: (value: number) => string;
};

const tuningControls: TuningControl[] = [];

const addTuningControl = (
  label: string,
  step: number,
  initialValue: number,
  apply: (rawValue: number) => number,
  format = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/\.?0+$/, '')),
) => {
  const row = document.createElement('label');
  row.style.display = 'grid';
  row.style.gridTemplateColumns = '1fr auto';
  row.style.gap = '8px';
  row.style.marginBottom = '10px';
  row.style.alignItems = 'center';

  const name = document.createElement('span');
  name.textContent = label;
  name.style.fontSize = '12px';
  name.style.opacity = '0.95';

  const valueLabel = document.createElement('span');
  valueLabel.style.fontSize = '12px';
  valueLabel.style.color = '#b8cbff';
  valueLabel.style.fontVariantNumeric = 'tabular-nums';

  const input = document.createElement('input');
  input.type = 'number';
  input.step = String(step);
  input.value = String(initialValue);
  input.inputMode = 'decimal';
  input.style.padding = '6px 8px';
  input.style.borderRadius = '7px';
  input.style.border = '1px solid #4c5f92';
  input.style.background = '#202d4d';
  input.style.color = '#f2f6ff';
  // iOS Safari auto-zooms focused inputs when font size is below 16px.
  // Keep tuning inputs at 16px so opening the keyboard doesn't zoom the game canvas.
  input.style.font = '600 16px system-ui, -apple-system, Segoe UI, sans-serif';
  input.style.gridColumn = '1 / -1';
  input.style.width = '100%';

  row.append(name, valueLabel, input);
  tuningPanel.append(row);

  const control: TuningControl = {
    input,
    valueLabel,
    apply,
    format,
  };
  tuningControls.push(control);
  return control;
};

const applyTwigTuningToWorld = () => {
  for (const twigObject of twigs) {
    twigObject.tuning = {
      angleLimitDeg: TWIG_TUNING.angleLimitDeg,
      weldStiffness: TWIG_TUNING.weldStiffness,
      weldDamping: TWIG_TUNING.weldDamping,
      angularDamping: TWIG_TUNING.angularDamping,
      densityMultiplier: TWIG_TUNING.densityMultiplier,
    };
    twigObject.twig.setTuning(twigObject.tuning);
  }
};

const segmentCountControl = addTuningControl(
  'Segment Count',
  1,
  TWIG_TUNING.segmentCount,
  (rawValue) => {
    TWIG_TUNING.segmentCount = Math.max(1, Math.round(rawValue));
    return TWIG_TUNING.segmentCount;
  },
);

const angleLimitControl = addTuningControl(
  'Angle Limit (deg)',
  0.01,
  TWIG_TUNING.angleLimitDeg,
  (rawValue) => {
    TWIG_TUNING.angleLimitDeg = rawValue;
    applyTwigTuningToWorld();
    return TWIG_TUNING.angleLimitDeg;
  },
);

const stiffnessControl = addTuningControl(
  'Weld Stiffness',
  0.01,
  TWIG_TUNING.weldStiffness,
  (rawValue) => {
    TWIG_TUNING.weldStiffness = rawValue;
    applyTwigTuningToWorld();
    return TWIG_TUNING.weldStiffness;
  },
);

const dampingControl = addTuningControl(
  'Weld Damping',
  0.01,
  TWIG_TUNING.weldDamping,
  (rawValue) => {
    TWIG_TUNING.weldDamping = rawValue;
    applyTwigTuningToWorld();
    return TWIG_TUNING.weldDamping;
  },
);

const angularDampingControl = addTuningControl(
  'Body Angular Damping',
  0.01,
  TWIG_TUNING.angularDamping,
  (rawValue) => {
    TWIG_TUNING.angularDamping = rawValue;
    applyTwigTuningToWorld();
    return TWIG_TUNING.angularDamping;
  },
);

const densityMultiplierControl = addTuningControl(
  'Twig Density Multiplier',
  0.01,
  TWIG_TUNING.densityMultiplier,
  (rawValue) => {
    TWIG_TUNING.densityMultiplier = Math.max(0.001, rawValue);
    applyTwigTuningToWorld();
    return TWIG_TUNING.densityMultiplier;
  },
);

const refreshTuningLabels = () => {
  for (const control of tuningControls) {
    const value = Number(control.input.value);
    if (!Number.isFinite(value)) {
      control.valueLabel.textContent = 'invalid';
      continue;
    }
    const applied = control.apply(value);
    control.valueLabel.textContent = control.format(applied);
  }
};

for (const control of tuningControls) {
  control.input.addEventListener('input', () => {
    refreshTuningLabels();
  });
}

const panelActions = document.createElement('div');
panelActions.style.display = 'flex';
panelActions.style.gap = '8px';
panelActions.style.marginTop = '6px';

const resetButton = document.createElement('button');
resetButton.type = 'button';
resetButton.textContent = 'Reset Defaults';
resetButton.style.flex = '1';
resetButton.style.border = '1px solid #4c5f92';
resetButton.style.background = '#202d4d';
resetButton.style.color = '#f2f6ff';
resetButton.style.borderRadius = '8px';
resetButton.style.padding = '7px 9px';
resetButton.style.font = '600 12px system-ui, -apple-system, Segoe UI, sans-serif';
resetButton.style.cursor = 'pointer';

panelActions.append(resetButton);
tuningPanel.append(panelActions);

const setTuningPanelOpen = (open: boolean) => {
  tuningPanel.style.display = open ? 'block' : 'none';
};

tuningButton.addEventListener('click', () => {
  const isOpen = tuningPanel.style.display === 'block';
  setTuningPanelOpen(!isOpen);
});

closeButton.addEventListener('click', () => {
  setTuningPanelOpen(false);
});

resetButton.addEventListener('click', () => {
  segmentCountControl.input.value = String(TWIG_DEFAULT_SEGMENT_COUNT);
  angleLimitControl.input.value = String(DEFAULT_TWIG_TUNING.angleLimitDeg);
  stiffnessControl.input.value = String(DEFAULT_TWIG_TUNING.weldStiffness);
  dampingControl.input.value = String(DEFAULT_TWIG_TUNING.weldDamping);
  angularDampingControl.input.value = String(DEFAULT_TWIG_TUNING.angularDamping);
  densityMultiplierControl.input.value = String(DEFAULT_TWIG_TUNING.densityMultiplier);
  refreshTuningLabels();
});

refreshTuningLabels();
app.append(tuningButton, tuningPanel);

const cloneVec2 = (vector: b2Vec2) => new b2Vec2(vector.x, vector.y);

const cloneTemplate = (template: PieceTemplate): PieceTemplate => (template.kind === 'rigid'
  ? {
    kind: 'rigid',
    id: template.id,
    color: template.color,
    vertices: template.vertices.map(cloneVec2),
  }
  : {
    kind: 'twig',
    id: template.id,
    color: template.color,
    length: template.length,
    thickness: template.thickness,
    segmentCount: template.segmentCount,
    tuning: { ...template.tuning },
  });

const cloneDraft = (draft: DraftPiece): DraftPiece => ({
  id: draft.id,
  template: cloneTemplate(draft.template),
  position: cloneVec2(draft.position),
  angle: draft.angle,
});

const isPhysicsPaused = () => Boolean(placement) || Boolean(worldManipulation) || Boolean(gesture) || drafts.length > 0;

const shouldShowUndoButton = () => Boolean(undoSnapshot) && !isPhysicsPaused();

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

const pointInsideTwigSegments = (point: b2Vec2, segments: ReturnType<typeof buildTwigPreviewSegments>) => {
  for (const segment of segments) {
    const dx = point.x - segment.position.x;
    const dy = point.y - segment.position.y;
    const c = Math.cos(segment.angle);
    const s = Math.sin(segment.angle);
    const along = dx * c + dy * s;
    const across = -dx * s + dy * c;
    const halfLength = segment.length * 0.5;
    const radius = segment.thickness * 0.56;

    if (Math.abs(along) <= halfLength && Math.abs(across) <= radius) {
      return true;
    }

    const distToStart = Math.hypot(along + halfLength, across);
    if (distToStart <= radius) {
      return true;
    }

    const distToEnd = Math.hypot(along - halfLength, across);
    if (distToEnd <= radius) {
      return true;
    }
  }

  return false;
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

const MIN_VERTEX_ANGLE_DEGREES = 65;
const ANGLE_SOFTENING_ITERATIONS = 4;

const getVertexInteriorAngle = (vertices: b2Vec2[], index: number) => {
  const prev = vertices[(index - 1 + vertices.length) % vertices.length];
  const current = vertices[index];
  const next = vertices[(index + 1) % vertices.length];

  const ax = prev.x - current.x;
  const ay = prev.y - current.y;
  const bx = next.x - current.x;
  const by = next.y - current.y;

  const magnitudeA = Math.hypot(ax, ay);
  const magnitudeB = Math.hypot(bx, by);
  if (magnitudeA < 0.0001 || magnitudeB < 0.0001) {
    return Math.PI;
  }

  const dot = clamp((ax * bx + ay * by) / (magnitudeA * magnitudeB), -1, 1);
  return Math.acos(dot);
};

const enforceMinimumVertexAngle = (vertices: b2Vec2[], minimumAngleDegrees = MIN_VERTEX_ANGLE_DEGREES) => {
  const minimumAngle = (minimumAngleDegrees * Math.PI) / 180;
  let currentVertices = vertices.map((vertex) => new b2Vec2(vertex.x, vertex.y));

  for (let iteration = 0; iteration < ANGLE_SOFTENING_ITERATIONS; iteration += 1) {
    let changed = false;
    const nextVertices = currentVertices.map((vertex) => new b2Vec2(vertex.x, vertex.y));

    for (let i = 0; i < currentVertices.length; i += 1) {
      const angle = getVertexInteriorAngle(currentVertices, i);
      if (angle >= minimumAngle) {
        continue;
      }

      const prev = currentVertices[(i - 1 + currentVertices.length) % currentVertices.length];
      const vertex = currentVertices[i];
      const next = currentVertices[(i + 1) % currentVertices.length];
      const midpoint = new b2Vec2((prev.x + next.x) * 0.5, (prev.y + next.y) * 0.5);
      const deficitRatio = clamp((minimumAngle - angle) / minimumAngle, 0, 1);
      const blend = 0.2 + deficitRatio * 0.45;

      nextVertices[i] = new b2Vec2(
        vertex.x + (midpoint.x - vertex.x) * blend,
        vertex.y + (midpoint.y - vertex.y) * blend,
      );
      changed = true;
    }

    currentVertices = nextVertices;
    if (!changed) {
      break;
    }
  }

  return currentVertices;
};

const createLongOrganicShape = () => {
  const length = 2.0 + Math.random() * 1.1;
  const thickness = 0.32 + Math.random() * 0.4;
  const halfLength = length / 2;
  const topTilt = 0.08 + Math.random() * 0.25;
  const bottomTilt = 0.1 + Math.random() * 0.22;

  return [
    new b2Vec2(-halfLength * (0.98 + Math.random() * 0.12), -thickness * (0.58 + Math.random() * 0.28)),
    new b2Vec2(-halfLength * (0.35 + Math.random() * 0.2), -thickness * (1.0 + topTilt)),
    new b2Vec2(halfLength * (0.35 + Math.random() * 0.2), -thickness * (0.82 + Math.random() * 0.24)),
    new b2Vec2(halfLength * (0.94 + Math.random() * 0.08), -thickness * (0.3 + Math.random() * 0.22)),
    new b2Vec2(halfLength * (0.72 + Math.random() * 0.18), thickness * (0.7 + bottomTilt)),
    new b2Vec2(-halfLength * (0.12 + Math.random() * 0.25), thickness * (1.0 + Math.random() * 0.2)),
    new b2Vec2(-halfLength * (0.92 + Math.random() * 0.1), thickness * (0.62 + Math.random() * 0.24)),
  ];
};

const createUltraLongOrganicShape = () => {
  const length = 3.2 + Math.random() * 1.6;
  const thickness = 0.18 + Math.random() * 0.2;
  const halfLength = length / 2;
  const topTilt = 0.08 + Math.random() * 0.28;
  const bottomTilt = 0.08 + Math.random() * 0.26;

  return [
    new b2Vec2(-halfLength * (0.98 + Math.random() * 0.1), -thickness * (0.58 + Math.random() * 0.24)),
    new b2Vec2(-halfLength * (0.4 + Math.random() * 0.18), -thickness * (1.0 + topTilt)),
    new b2Vec2(halfLength * (0.36 + Math.random() * 0.16), -thickness * (0.8 + Math.random() * 0.2)),
    new b2Vec2(halfLength * (0.94 + Math.random() * 0.06), -thickness * (0.34 + Math.random() * 0.22)),
    new b2Vec2(halfLength * (0.7 + Math.random() * 0.16), thickness * (0.72 + bottomTilt)),
    new b2Vec2(-halfLength * (0.15 + Math.random() * 0.2), thickness * (0.98 + Math.random() * 0.2)),
    new b2Vec2(-halfLength * (0.94 + Math.random() * 0.08), thickness * (0.64 + Math.random() * 0.22)),
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
    new b2Vec2(hw * (0.96 + Math.random() * 0.1), -hh * (0.28 + Math.random() * 0.22)),
    new b2Vec2(hw * (0.7 + Math.random() * 0.24), hh * (0.75 + Math.random() * 0.24)),
    new b2Vec2(hw * (0.08 + Math.random() * 0.24), hh * (1.0 + Math.random() * 0.2)),
    new b2Vec2(-hw * (0.82 + Math.random() * 0.18), hh * (0.78 + Math.random() * 0.24)),
    new b2Vec2(-hw * (0.96 + Math.random() * 0.1), hh * (0.28 + Math.random() * 0.22)),
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

const createRigidTemplate = (): RigidPieceTemplate => {
  pieceCounter += 1;
  const shapeBuilders = [
    createUltraLongOrganicShape,
    createUltraLongOrganicShape,
    createUltraLongOrganicShape,
    createLongOrganicShape,
    createLongOrganicShape,
    createLongOrganicShape,
    createLongOrganicShape,
    createSquarishOrganicShape,
    createRoundedTriShape,
  ];
  const chosenShape = shapeBuilders[Math.floor(Math.random() * shapeBuilders.length)]();
  const lessPointyShape = enforceMinimumVertexAngle(chosenShape);
  const normalizedVertices = normalizeVerticesArea(lessPointyShape, 1.35 + Math.random() * 0.22);
  return {
    kind: 'rigid',
    id: `piece-${pieceCounter}`,
    vertices: normalizedVertices,
    color: randomColor(),
  };
};

const createTwigTemplate = (): TwigPieceTemplate => {
  pieceCounter += 1;
  const segmentCount = Math.max(1, Math.round(TWIG_TUNING.segmentCount));
  return {
    kind: 'twig',
    id: `piece-${pieceCounter}`,
    color: TWIG_COLOR,
    length: TWIG_DEFAULT_LENGTH,
    thickness: TWIG_DEFAULT_THICKNESS,
    segmentCount,
    tuning: {
      angleLimitDeg: TWIG_TUNING.angleLimitDeg,
      weldStiffness: TWIG_TUNING.weldStiffness,
      weldDamping: TWIG_TUNING.weldDamping,
      angularDamping: TWIG_TUNING.angularDamping,
      densityMultiplier: TWIG_TUNING.densityMultiplier,
    },
  };
};

const pickNextTwigTemplateAt = () => {
  const targetInterval = Math.max(1, Math.floor(TWIG_TEMPLATE_TARGET_INTERVAL));
  const variance = Math.max(0, Math.floor(TWIG_TEMPLATE_INTERVAL_VARIANCE));
  const minInterval = Math.max(1, targetInterval - variance);
  const maxInterval = targetInterval + variance;
  return randomizedTemplateCounter + minInterval + Math.floor(Math.random() * (maxInterval - minInterval + 1));
};

const createTemplate = (): PieceTemplate => {
  randomizedTemplateCounter += 1;
  if (nextTwigTemplateAt === 0) {
    nextTwigTemplateAt = pickNextTwigTemplateAt();
  }

  if (randomizedTemplateCounter >= nextTwigTemplateAt) {
    nextTwigTemplateAt = pickNextTwigTemplateAt();
    return createTwigTemplate();
  }

  return createRigidTemplate();
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
  worldFloorY = worldHeight;

  floorBody = world.CreateBody({ type: b2BodyType.b2_staticBody });
  floorBody.CreateFixture({
    shape: new b2PolygonShape().SetAsBox(worldHalfWidth + 4, floorHalfHeight, { x: 0, y: worldFloorY + floorHalfHeight }, 0),
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

const nextWorldObjectId = (prefix: 'world-shape' | 'world-twig') => {
  worldShapeCounter += 1;
  return `${prefix}-${worldShapeCounter}`;
};

const spawnPlacedRigidShape = (
  template: RigidPieceTemplate,
  position: b2Vec2,
  angle: number,
  explicitId?: string,
  linearVelocity?: b2Vec2,
  angularVelocity?: number,
) => {
  const body = world.CreateBody({
    type: b2BodyType.b2_dynamicBody,
    position: cloneVec2(position),
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

  if (linearVelocity) {
    body.SetLinearVelocity(cloneVec2(linearVelocity));
  }
  if (angularVelocity !== undefined) {
    body.SetAngularVelocity(angularVelocity);
  }

  const id = explicitId ?? nextWorldObjectId('world-shape');

  const shape: FallingShape = {
    kind: 'rigid',
    id,
    body,
    color: template.color,
    vertices: template.vertices,
  };
  shapes.push(shape);
  worldObjectOrder.push({ kind: 'rigid', id });
};

const spawnPlacedTwig = (
  template: TwigPieceTemplate,
  position: b2Vec2,
  angle: number,
  explicitId?: string,
  segmentStates?: SnapshotTwigSegment[],
) => {
  const twig = new Twig(
    world,
    cloneVec2(position),
    template.length,
    template.thickness,
    template.segmentCount,
    {
      ...template.tuning,
      initialAngle: angle,
    },
  );

  if (segmentStates) {
    const bodies = twig.getBodies();
    for (let i = 0; i < Math.min(bodies.length, segmentStates.length); i += 1) {
      const body = bodies[i];
      const state = segmentStates[i];
      body.SetTransformVec(cloneVec2(state.position), state.angle);
      body.SetLinearVelocity(cloneVec2(state.linearVelocity));
      body.SetAngularVelocity(state.angularVelocity);
    }
  }

  const id = explicitId ?? nextWorldObjectId('world-twig');
  twigs.push({
    kind: 'twig',
    id,
    twig,
    color: template.color,
    length: template.length,
    thickness: template.thickness,
    segmentCount: template.segmentCount,
    tuning: { ...template.tuning },
  });
  worldObjectOrder.push({ kind: 'twig', id });
};

const spawnPlacedTemplate = (template: PieceTemplate, position: b2Vec2, angle: number) => {
  if (template.kind === 'twig') {
    spawnPlacedTwig(template, position, angle);
    return;
  }
  spawnPlacedRigidShape(template, position, angle);
};

const spawnSnapshotObject = (snapshot: SnapshotWorldObject) => {
  if (snapshot.kind === 'twig') {
    const twigTemplate: TwigPieceTemplate = {
      kind: 'twig',
      id: snapshot.id,
      color: snapshot.color,
      length: snapshot.length,
      thickness: snapshot.thickness,
      segmentCount: snapshot.segmentCount,
      tuning: { ...snapshot.tuning },
    };
    const center = snapshot.segments.length > 0
      ? snapshot.segments.reduce((acc, segment) => new b2Vec2(acc.x + segment.position.x, acc.y + segment.position.y), new b2Vec2(0, 0))
      : new b2Vec2(0, 0);
    const spawnPosition = snapshot.segments.length > 0
      ? new b2Vec2(center.x / snapshot.segments.length, center.y / snapshot.segments.length)
      : new b2Vec2(0, 0);
    const spawnAngle = snapshot.segments[0]?.angle ?? 0;
    spawnPlacedTwig(twigTemplate, spawnPosition, spawnAngle, snapshot.id, snapshot.segments);
    return;
  }

  const rigidTemplate: RigidPieceTemplate = {
    kind: 'rigid',
    id: snapshot.id,
    color: snapshot.color,
    vertices: snapshot.vertices.map(cloneVec2),
  };
  spawnPlacedRigidShape(
    rigidTemplate,
    snapshot.position,
    snapshot.angle,
    snapshot.id,
    snapshot.linearVelocity,
    snapshot.angularVelocity,
  );
};

const captureUndoSnapshot = (draftsBeforeApply: DraftPiece[]) => {
  const resolvedSelectedObject = selectedObject?.kind === 'placement' && placement
    ? { kind: 'draft', id: placement.draftId } as const
    : selectedObject;

  const rigidSnapshots = new Map<string, SnapshotShape>();
  for (const shape of shapes) {
    rigidSnapshots.set(shape.id, {
      kind: 'rigid',
      id: shape.id,
      color: shape.color,
      vertices: shape.vertices.map(cloneVec2),
      position: cloneVec2(shape.body.GetPosition()),
      angle: shape.body.GetAngle(),
      linearVelocity: cloneVec2(shape.body.GetLinearVelocity()),
      angularVelocity: shape.body.GetAngularVelocity(),
    });
  }

  const twigSnapshots = new Map<string, SnapshotTwig>();
  for (const twigObject of twigs) {
    const segments = twigObject.twig.getBodies().map((body) => ({
      position: cloneVec2(body.GetPosition()),
      angle: body.GetAngle(),
      linearVelocity: cloneVec2(body.GetLinearVelocity()),
      angularVelocity: body.GetAngularVelocity(),
    }));

    twigSnapshots.set(twigObject.id, {
      kind: 'twig',
      id: twigObject.id,
      color: twigObject.color,
      length: twigObject.length,
      thickness: twigObject.thickness,
      segmentCount: twigObject.segmentCount,
      tuning: { ...twigObject.tuning },
      segments,
    });
  }

  const worldObjects = worldObjectOrder.flatMap((item): SnapshotWorldObject[] => {
    if (item.kind === 'rigid') {
      const snapshot = rigidSnapshots.get(item.id);
      return snapshot ? [snapshot] : [];
    }
    const snapshot = twigSnapshots.get(item.id);
    return snapshot ? [snapshot] : [];
  });

  undoSnapshot = {
    worldObjects,
    drafts: draftsBeforeApply.map(cloneDraft),
    palette: palette.map((template) => (template ? cloneTemplate(template) : undefined)),
    selectedObject: resolvedSelectedObject,
    worldShapeCounter,
    draftCounter,
  };
};

const destroyAllWorldObjects = () => {
  for (const shape of shapes) {
    world.DestroyBody(shape.body);
  }
  shapes.length = 0;

  for (const twigObject of twigs) {
    twigObject.twig.destroy();
  }
  twigs.length = 0;
  worldObjectOrder.length = 0;
  pruneTwigRenderCache([]);
};

const restoreUndoSnapshot = () => {
  if (!undoSnapshot) {
    return;
  }

  destroyAllWorldObjects();

  for (const snapshotObject of undoSnapshot.worldObjects) {
    spawnSnapshotObject(snapshotObject);
  }

  drafts = undoSnapshot.drafts.map(cloneDraft);
  palette = undoSnapshot.palette.map((template) => (template ? cloneTemplate(template) : undefined));
  selectedObject = undoSnapshot.selectedObject;
  worldShapeCounter = undoSnapshot.worldShapeCounter;
  draftCounter = undoSnapshot.draftCounter;

  placement = undefined;
  worldManipulation = undefined;
  gesture = undefined;
  activePointers.clear();
  undoSnapshot = undefined;

  rebuildMenuLayout();
};

const destroyWorldObject = (objectRef: WorldObjectRef) => {
  if (objectRef.kind === 'rigid') {
    const index = shapes.findIndex((shape) => shape.id === objectRef.id);
    if (index !== -1) {
      const [shape] = shapes.splice(index, 1);
      world.DestroyBody(shape.body);
    }
  } else {
    const index = twigs.findIndex((twigObject) => twigObject.id === objectRef.id);
    if (index !== -1) {
      const [twigObject] = twigs.splice(index, 1);
      twigObject.twig.destroy();
      pruneTwigRenderCache(twigs.map((entry) => entry.id));
    }
  }

  if (selectedObject?.kind === 'world' && selectedObject.id === objectRef.id) {
    selectedObject = undefined;
  }
  if (worldManipulation?.shape.id === objectRef.id) {
    worldManipulation = undefined;
  }
};

const trimWorldObjects = () => {
  while (worldObjectOrder.length > WORLD_OBJECT_LIMIT) {
    const oldest = worldObjectOrder.shift();
    if (!oldest) {
      break;
    }
    destroyWorldObject(oldest);
  }
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

  pruneTwigRenderCache(twigs.map((twigObject) => twigObject.id));

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

  for (const twigObject of twigs) {
    const segmentTransforms = twigObject.twig.getSegmentTransforms();
    drawTwig(
      context,
      twigObject.id,
      segmentTransforms,
      twigObject.color,
      PHYSICS_SCALE,
    );
    if (selectedObject?.kind === 'world' && selectedObject.id === twigObject.id) {
      drawTwigPreview(context, segmentTransforms, '#ffffff', PHYSICS_SCALE, 0.2);
    }
  }

  for (const draft of drafts) {
    if (draft.template.kind === 'twig') {
      const previewSegments = buildTwigPreviewSegments(
        draft.position,
        draft.template.length,
        draft.template.thickness,
        draft.template.segmentCount,
        draft.angle,
      );
      drawTwigPreview(context, previewSegments, draft.template.color, PHYSICS_SCALE, 0.86);
      if (selectedObject?.kind === 'draft' && selectedObject.id === draft.id) {
        drawTwigPreview(context, previewSegments, '#ffffff', PHYSICS_SCALE, 0.22);
      }
    } else {
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
  }

  if (placement) {
    if (placement.template.kind === 'twig') {
      const previewSegments = buildTwigPreviewSegments(
        placement.position,
        placement.template.length,
        placement.template.thickness,
        placement.template.segmentCount,
        placement.angle,
      );
      drawTwigPreview(context, previewSegments, placement.template.color, PHYSICS_SCALE, 0.9);
      if (selectedObject?.kind === 'placement' && selectedObject.id === placement.draftId) {
        drawTwigPreview(context, previewSegments, '#ffffff', PHYSICS_SCALE, 0.25);
      }
    } else {
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
  const canUndo = shouldShowUndoButton();
  context.fillStyle = canUndo ? '#d68a2d' : canApply ? '#2dbf6e' : '#4c5a76';
  context.beginPath();
  context.arc(
    applyButtonRect.x + applyButtonRect.width / 2,
    applyButtonRect.y + applyButtonRect.height / 2,
    applyButtonRect.width / 2,
    0,
    Math.PI * 2,
  );
  context.fill();

  const cx = applyButtonRect.x + applyButtonRect.width / 2;
  const cy = applyButtonRect.y + applyButtonRect.height / 2;
  const iconSize = applyButtonRect.width * 0.34;

  context.fillStyle = 'white';
  context.strokeStyle = 'white';

  if (canUndo) {
    context.lineWidth = 5;
    context.lineCap = 'round';
    context.beginPath();
    context.arc(cx, cy, iconSize * 0.88, Math.PI * 0.1, Math.PI * 1.3, true);
    context.stroke();

    context.beginPath();
    context.moveTo(cx - iconSize * 0.9, cy - iconSize * 0.4);
    context.lineTo(cx - iconSize * 1.25, cy - iconSize * 0.75);
    context.lineTo(cx - iconSize * 0.7, cy - iconSize * 0.9);
    context.closePath();
    context.fill();
  } else {
    context.beginPath();
    context.moveTo(cx - iconSize * 0.45, cy - iconSize * 0.85);
    context.lineTo(cx - iconSize * 0.45, cy + iconSize * 0.85);
    context.lineTo(cx + iconSize * 0.95, cy);
    context.closePath();
    context.fill();
  }

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

    context.save();
    context.beginPath();
    context.rect(card.x + 4, card.y + 4, card.width - 8, card.height - 8);
    context.clip();
    context.translate(centerX, centerY);
    context.scale(MENU_PREVIEW_WORLD_SCALE, MENU_PREVIEW_WORLD_SCALE);
    if (card.template.kind === 'twig') {
      const previewSegments = buildTwigPreviewSegments(
        new b2Vec2(0, 0),
        card.template.length * 0.82,
        card.template.thickness,
        card.template.segmentCount,
        0,
      );
      drawTwigPreview(context, previewSegments, card.template.color, PHYSICS_SCALE);
    } else {
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
    }
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
    if (draft.template.kind === 'twig') {
      const twigSegments = buildTwigPreviewSegments(
        draft.position,
        draft.template.length,
        draft.template.thickness,
        draft.template.segmentCount,
        draft.angle,
      );
      if (pointInsideTwigSegments(point, twigSegments)) {
        return draft;
      }
    } else {
      const vertices = transformedVertices(draft.template.vertices, draft.position, draft.angle);
      if (isPointInPolygon(point, vertices)) {
        return draft;
      }
    }
  }

  return undefined;
};

const getTwigCenter = (twigObject: TwigWorldObject) => {
  const bodies = twigObject.twig.getBodies();
  if (bodies.length === 0) {
    return new b2Vec2(0, 0);
  }

  const sum = bodies.reduce((acc, body) => {
    const position = body.GetPosition();
    return new b2Vec2(acc.x + position.x, acc.y + position.y);
  }, new b2Vec2(0, 0));
  return new b2Vec2(sum.x / bodies.length, sum.y / bodies.length);
};

const getTwigAverageAngle = (twigObject: TwigWorldObject) => {
  const bodies = twigObject.twig.getBodies();
  if (bodies.length === 0) {
    return 0;
  }

  const sum = bodies.reduce((acc, body) => {
    const angle = body.GetAngle();
    return new b2Vec2(acc.x + Math.cos(angle), acc.y + Math.sin(angle));
  }, new b2Vec2(0, 0));
  return Math.atan2(sum.y, sum.x);
};

const setTwigPosition = (twigObject: TwigWorldObject, targetPosition: b2Vec2) => {
  const currentCenter = getTwigCenter(twigObject);
  const dx = targetPosition.x - currentCenter.x;
  const dy = targetPosition.y - currentCenter.y;
  for (const body of twigObject.twig.getBodies()) {
    const position = body.GetPosition();
    body.SetTransformVec(new b2Vec2(position.x + dx, position.y + dy), body.GetAngle());
    body.SetAwake(true);
  }
};

const setTwigAngle = (twigObject: TwigWorldObject, targetAngle: number) => {
  const currentCenter = getTwigCenter(twigObject);
  const currentAngle = getTwigAverageAngle(twigObject);
  const delta = targetAngle - currentAngle;
  const c = Math.cos(delta);
  const s = Math.sin(delta);

  for (const body of twigObject.twig.getBodies()) {
    const position = body.GetPosition();
    const relX = position.x - currentCenter.x;
    const relY = position.y - currentCenter.y;
    const rotatedRelX = relX * c - relY * s;
    const rotatedRelY = relX * s + relY * c;
    body.SetTransformVec(
      new b2Vec2(currentCenter.x + rotatedRelX, currentCenter.y + rotatedRelY),
      body.GetAngle() + delta,
    );
    body.SetLinearVelocity(new b2Vec2(0, 0));
    body.SetAngularVelocity(0);
    body.SetAwake(true);
  }
};

const worldShapeAtPoint = (point: b2Vec2): FallingShape | TwigWorldObject | undefined => {
  for (let i = twigs.length - 1; i >= 0; i -= 1) {
    const twigObject = twigs[i];
    if (pointInsideTwigSegments(point, twigObject.twig.getSegmentTransforms())) {
      return twigObject;
    }
  }

  for (let i = shapes.length - 1; i >= 0; i -= 1) {
    const shape = shapes[i];
    const vertices = transformedVertices(shape.vertices, shape.body.GetPosition(), shape.body.GetAngle());
    if (isPointInPolygon(point, vertices)) {
      return shape;
    }
  }

  return undefined;
};

const rotateTargetBy = (target: TransformTarget, deltaRadians: number) => {
  target.setAngle(target.getAngle() + deltaRadians);

  if (target.selected.kind === 'world') {
    const shape = shapes.find((candidate) => candidate.id === target.selected.id);
    if (shape) {
      shape.body.SetAwake(true);
      return;
    }
    const twigObject = twigs.find((candidate) => candidate.id === target.selected.id);
    if (twigObject) {
      for (const body of twigObject.twig.getBodies()) {
        body.SetAwake(true);
      }
    }
  }
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

const beginWorldManipulation = (shape: FallingShape | TwigWorldObject, pointerId: number, pointerWorld: b2Vec2) => {
  const shapePosition = shape.kind === 'rigid' ? shape.body.GetPosition() : getTwigCenter(shape);
  if (shape.kind === 'rigid') {
    shape.body.SetAwake(true);
    shape.body.SetLinearVelocity(new b2Vec2(0, 0));
    shape.body.SetAngularVelocity(0);
  } else {
    for (const body of shape.twig.getBodies()) {
      body.SetAwake(true);
      body.SetLinearVelocity(new b2Vec2(0, 0));
      body.SetAngularVelocity(0);
    }
  }

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
    const shape = shapes.find((candidate) => candidate.id === selectedObject!.id)
      ?? twigs.find((candidate) => candidate.id === selectedObject!.id);
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
    const manipulatedShape = worldManipulation.shape;
    return {
      selected: { kind: 'world', id: manipulatedShape.id },
      getPosition: () => (manipulatedShape.kind === 'rigid' ? manipulatedShape.body.GetPosition() : getTwigCenter(manipulatedShape)),
      getAngle: () => (manipulatedShape.kind === 'rigid' ? manipulatedShape.body.GetAngle() : getTwigAverageAngle(manipulatedShape)),
      setPosition: (position: b2Vec2) => {
        if (manipulatedShape.kind === 'rigid') {
          manipulatedShape.body.SetTransformVec(position, manipulatedShape.body.GetAngle());
        } else {
          setTwigPosition(manipulatedShape, position);
        }
      },
      setAngle: (angle: number) => {
        if (manipulatedShape.kind === 'rigid') {
          manipulatedShape.body.SetTransformVec(manipulatedShape.body.GetPosition(), angle);
        } else {
          setTwigAngle(manipulatedShape, angle);
        }
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

  const shape = shapes.find((candidate) => candidate.id === selected.id)
    ?? twigs.find((candidate) => candidate.id === selected.id);
  if (!shape) {
    return undefined;
  }

  return {
    selected,
    getPosition: () => (shape.kind === 'rigid' ? shape.body.GetPosition() : getTwigCenter(shape)),
    getAngle: () => (shape.kind === 'rigid' ? shape.body.GetAngle() : getTwigAverageAngle(shape)),
    setPosition: (position: b2Vec2) => {
      if (shape.kind === 'rigid') {
        shape.body.SetTransformVec(position, shape.body.GetAngle());
      } else {
        setTwigPosition(shape, position);
      }
    },
    setAngle: (angle: number) => {
      if (shape.kind === 'rigid') {
        shape.body.SetTransformVec(shape.body.GetPosition(), angle);
      } else {
        setTwigAngle(shape, angle);
      }
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
  const draftsToApply = placement
    ? [...drafts, {
      id: placement.draftId,
      template: placement.template,
      position: placement.position,
      angle: placement.angle,
    }]
    : drafts;

  if (draftsToApply.length === 0) {
    return;
  }

  captureUndoSnapshot(draftsToApply);

  if (placement) {
    commitActivePlacementToDraft();
  }

  for (const draft of drafts) {
    spawnPlacedTemplate(draft.template, draft.position, draft.angle);
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
    if (shouldShowUndoButton()) {
      restoreUndoSnapshot();
    } else {
      applyDrafts();
    }
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

canvas.addEventListener('wheel', (event) => {
  const wheelDelta = event.deltaY;
  const rawRotationDelta = wheelDelta * WHEEL_ROTATION_RADIANS_PER_DELTA_Y;
  const rotationDelta = Math.max(-MAX_WHEEL_ROTATION_STEP_RAD, Math.min(MAX_WHEEL_ROTATION_STEP_RAD, rawRotationDelta));

  if (rotationDelta === 0) {
    return;
  }

  let target = currentManipulationTarget() ?? selectedTarget();
  if (!target) {
    const worldPoint = toWorldFromCanvas(event.clientX, event.clientY);
    const draft = draftAtPoint(worldPoint);
    if (draft) {
      selectedObject = { kind: 'draft', id: draft.id };
      target = selectedTarget();
    } else {
      const shape = worldShapeAtPoint(worldPoint);
      if (shape) {
        selectedObject = { kind: 'world', id: shape.id };
        target = selectedTarget();
      }
    }
  }

  if (!target) {
    return;
  }

  rotateTargetBy(target, rotationDelta);
  event.preventDefault();
}, { passive: false });

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
  const physicsPaused = isPhysicsPaused();
  if (!physicsPaused) {
    const subSteps = twigs.length > 0 ? TWIG_PHYSICS_SUBSTEPS : 1;
    const subStepDelta = TIME_STEP / subSteps;
    for (let i = 0; i < subSteps; i += 1) {
      for (const twigObject of twigs) {
        twigObject.twig.updateSoftness(subStepDelta);
      }
      world.Step(subStepDelta, STEP_CONFIG);
    }
  }

  trimWorldObjects();

  render();
  requestAnimationFrame(tick);
};

window.addEventListener('resize', resize);
window.visualViewport?.addEventListener('resize', resize);

refillPalette();
resize();
requestAnimationFrame(tick);
