import {
  b2Body,
  b2BodyType,
  b2PolygonShape,
  b2RevoluteJoint,
  b2RevoluteJointDef,
  b2Vec2,
  b2World,
} from '@box2d/core';

export type TwigTuning = {
  angleLimitDeg: number;
  jointStiffness: number;
  jointDamping: number;
  angularDamping: number;
};

export type TwigSegmentTransform = {
  position: b2Vec2;
  angle: number;
  length: number;
  thickness: number;
};

export type TwigOptions = Partial<TwigTuning> & {
  initialAngle?: number;
  bulletSegments?: boolean;
};

export const DEFAULT_TWIG_TUNING: TwigTuning = {
  angleLimitDeg: 15,
  jointStiffness: 8,
  jointDamping: 2.4,
  angularDamping: 1.8,
};

const FIXTURE_THICKNESS_SCALE = 1.18;
const MIN_FIXTURE_THICKNESS = 0.14;
const MIN_SEGMENT_COUNT = 1;
const DEFAULT_STEP_SECONDS = 1 / 60;
const MAX_ABS_ANGLE_LIMIT_DEG = 170;
const ANGLE_SETTLE_DEADBAND_RAD = 0.003;
const SPEED_SETTLE_DEADBAND_RAD_PER_SEC = 0.04;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
const rotateVector = (x: number, y: number, angle: number) => {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return new b2Vec2(x * c - y * s, x * s + y * c);
};

/**
 * Bendy twig made from rigid segments connected by revolute joints.
 *
 * NOTE (@box2d/core): revolute joints do not expose native spring/damping fields.
 * Softness is approximated with a motor PD controller in `updateSoftness()`.
 */
export class Twig {
  private readonly world: b2World;
  private readonly totalLength: number;
  private readonly visualThickness: number;
  private readonly segmentCount: number;
  private readonly segmentLength: number;
  private readonly fixtureThickness: number;
  private readonly bodies: b2Body[] = [];
  private readonly joints: b2RevoluteJoint[] = [];
  private tuning: TwigTuning;
  private destroyed = false;

  constructor(
    world: b2World,
    startPos: b2Vec2,
    length: number,
    thickness: number,
    segmentCount: number,
    options: TwigOptions = {},
  ) {
    this.world = world;
    this.totalLength = Math.max(length, 0.6);
    this.visualThickness = Math.max(thickness, 0.12);
    this.segmentCount = Math.max(MIN_SEGMENT_COUNT, Math.round(segmentCount));
    this.segmentLength = this.totalLength / this.segmentCount;
    this.fixtureThickness = Math.max(this.visualThickness * FIXTURE_THICKNESS_SCALE, MIN_FIXTURE_THICKNESS);
    this.tuning = {
      ...DEFAULT_TWIG_TUNING,
      ...options,
    };

    const initialAngle = options.initialAngle ?? 0;
    const halfLength = this.totalLength / 2;
    const segmentMass = 1 / this.segmentCount;
    const fixtureArea = this.segmentLength * this.fixtureThickness;
    const density = segmentMass / Math.max(fixtureArea, 0.01);

    for (let i = 0; i < this.segmentCount; i += 1) {
      const localCenterX = -halfLength + this.segmentLength * (i + 0.5);
      const offset = rotateVector(localCenterX, 0, initialAngle);
      const body = this.world.CreateBody({
        type: b2BodyType.b2_dynamicBody,
        position: new b2Vec2(startPos.x + offset.x, startPos.y + offset.y),
        angle: initialAngle,
        linearDamping: 0.24,
        angularDamping: this.getSafeAngularDamping(),
        bullet: Boolean(options.bulletSegments),
      });

      const fixtureShape = new b2PolygonShape().SetAsBox(this.segmentLength * 0.5, this.fixtureThickness * 0.5);
      body.CreateFixture({
        shape: fixtureShape,
        density,
        friction: 0.82,
        restitution: 0,
      });

      this.bodies.push(body);
    }

    const angleLimit = this.getSafeAngleLimitRadians();
    const initialTorque = this.computeController(DEFAULT_STEP_SECONDS).driveTorque;
    for (let i = 0; i < this.bodies.length - 1; i += 1) {
      const bodyA = this.bodies[i];
      const bodyB = this.bodies[i + 1];
      const localAnchorX = -halfLength + this.segmentLength * (i + 1);
      const anchorOffset = rotateVector(localAnchorX, 0, initialAngle);
      const anchor = new b2Vec2(startPos.x + anchorOffset.x, startPos.y + anchorOffset.y);
      const jointDef = new b2RevoluteJointDef();
      jointDef.Initialize(bodyA, bodyB, anchor);
      jointDef.enableLimit = true;
      jointDef.lowerAngle = -angleLimit;
      jointDef.upperAngle = angleLimit;
      jointDef.enableMotor = true;
      jointDef.motorSpeed = 0;
      jointDef.maxMotorTorque = initialTorque;
      jointDef.collideConnected = false;

      this.joints.push(this.world.CreateJoint(jointDef));
    }
  }

  private getSafeAngleLimitRadians() {
    return toRadians(clamp(Math.abs(this.tuning.angleLimitDeg), 0.1, MAX_ABS_ANGLE_LIMIT_DEG));
  }

  private getSafeAngularDamping() {
    return Number.isFinite(this.tuning.angularDamping)
      ? Math.max(0, this.tuning.angularDamping)
      : DEFAULT_TWIG_TUNING.angularDamping;
  }

  private computeController(stepSeconds: number) {
    const userStiffness = Number.isFinite(this.tuning.jointStiffness) ? Math.max(0, this.tuning.jointStiffness) : 0;
    const userDamping = Number.isFinite(this.tuning.jointDamping) ? Math.max(0, this.tuning.jointDamping) : 0;

    // Compress extreme user values with log scaling so tuning stays responsive but stable.
    const hertz = clamp(Math.log1p(userStiffness) * 1.1, 0, 8);
    const dampingRatio = clamp(Math.log1p(userDamping) * 0.4, 0, 3);
    const omega = 2 * Math.PI * hertz;

    return {
      proportional: omega * omega,
      derivative: 2 * dampingRatio * omega,
      driveTorque: clamp(0.06 + Math.log1p(userStiffness + 1) * 1.4 + Math.log1p(userDamping + 1) * 2.6, 0.06, 30),
      settleTorque: clamp(0.02 + Math.log1p(userDamping + 1) * 0.4, 0.02, 3),
      maxSpeed: clamp(2 + hertz * 0.8, 2, 8),
      stepSeconds,
    };
  }

  public setTuning(tuning: Partial<TwigTuning>) {
    this.tuning = {
      ...this.tuning,
      ...tuning,
    };
    const angleLimit = this.getSafeAngleLimitRadians();
    const { driveTorque } = this.computeController(DEFAULT_STEP_SECONDS);
    for (const body of this.bodies) {
      body.SetAngularDamping(this.getSafeAngularDamping());
    }
    for (const joint of this.joints) {
      joint.SetLimits(-angleLimit, angleLimit);
      joint.SetMaxMotorTorque(driveTorque);
      joint.EnableMotor(true);
    }
  }

  public updateSoftness(stepSeconds = DEFAULT_STEP_SECONDS) {
    const controller = this.computeController(stepSeconds);
    for (const joint of this.joints) {
      const angle = joint.GetJointAngle();
      const speed = joint.GetJointSpeed();

      if (Math.abs(angle) < ANGLE_SETTLE_DEADBAND_RAD && Math.abs(speed) < SPEED_SETTLE_DEADBAND_RAD_PER_SEC) {
        joint.SetMotorSpeed(0);
        joint.SetMaxMotorTorque(controller.settleTorque);
        continue;
      }

      const targetSpeed = clamp(
        -(angle * controller.proportional + speed * controller.derivative) * controller.stepSeconds,
        -controller.maxSpeed,
        controller.maxSpeed,
      );
      joint.SetMotorSpeed(targetSpeed);
      joint.SetMaxMotorTorque(controller.driveTorque);
    }
  }

  public getSegmentTransforms(): TwigSegmentTransform[] {
    return this.bodies.map((body) => ({
      position: new b2Vec2(body.GetPosition().x, body.GetPosition().y),
      angle: body.GetAngle(),
      length: this.segmentLength,
      thickness: this.visualThickness,
    }));
  }

  public getBodies() {
    return this.bodies;
  }

  public destroy() {
    if (this.destroyed) {
      return;
    }

    for (const joint of this.joints) {
      this.world.DestroyJoint(joint);
    }
    for (const body of this.bodies) {
      this.world.DestroyBody(body);
    }

    this.joints.length = 0;
    this.bodies.length = 0;
    this.destroyed = true;
  }
}
