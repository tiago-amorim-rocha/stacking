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
    this.segmentCount = Math.max(3, Math.round(segmentCount));
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
        linearDamping: 0.1,
        angularDamping: this.tuning.angularDamping,
        bullet: Boolean(options.bulletSegments),
      });

      const fixtureShape = new b2PolygonShape().SetAsBox(this.segmentLength * 0.5, this.fixtureThickness * 0.5);
      body.CreateFixture({
        shape: fixtureShape,
        density,
        friction: 0.72,
        restitution: 0.04,
      });

      this.bodies.push(body);
    }

    const angleLimit = toRadians(this.tuning.angleLimitDeg);
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
      jointDef.maxMotorTorque = this.computeMaxMotorTorque();
      jointDef.collideConnected = false;

      this.joints.push(this.world.CreateJoint(jointDef));
    }
  }

  private computeMaxMotorTorque() {
    return clamp(0.1 + this.tuning.jointStiffness * 0.22 + this.tuning.jointDamping * 0.08, 0.08, 10);
  }

  public setTuning(tuning: Partial<TwigTuning>) {
    this.tuning = {
      ...this.tuning,
      ...tuning,
    };
    const angleLimit = toRadians(this.tuning.angleLimitDeg);
    for (const body of this.bodies) {
      body.SetAngularDamping(this.tuning.angularDamping);
    }
    for (const joint of this.joints) {
      joint.SetLimits(-angleLimit, angleLimit);
      joint.SetMaxMotorTorque(this.computeMaxMotorTorque());
      joint.EnableMotor(true);
    }
  }

  public updateSoftness() {
    const maxMotorTorque = this.computeMaxMotorTorque();
    for (const joint of this.joints) {
      const angle = joint.GetJointAngle();
      const speed = joint.GetJointSpeed();
      const targetSpeed = clamp(
        -angle * this.tuning.jointStiffness - speed * this.tuning.jointDamping,
        -16,
        16,
      );
      joint.SetMotorSpeed(targetSpeed);
      joint.SetMaxMotorTorque(maxMotorTorque);
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
