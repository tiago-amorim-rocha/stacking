import {
  b2Body,
  b2AngularStiffness,
  b2BodyType,
  b2MassData,
  b2PolygonShape,
  b2Vec2,
  b2WeldJoint,
  b2WeldJointDef,
  b2World,
} from '@box2d/core';

export type TwigTuning = {
  angleLimitDeg: number;
  weldStiffness: number;
  weldDamping: number;
  angularDamping: number;
  mass: number;
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
  weldStiffness: 8,
  weldDamping: 2.4,
  angularDamping: 1.8,
  mass: 1,
};

const FIXTURE_THICKNESS_SCALE = 1.18;
const MIN_FIXTURE_THICKNESS = 0.14;
const MIN_SEGMENT_COUNT = 1;
const DEFAULT_STEP_SECONDS = 1 / 60;
const MAX_ABS_ANGLE_LIMIT_DEG = 170;
const LIMIT_DEADBAND_RAD = 0.002;
const LIMIT_SPEED_DEADBAND_RAD_PER_SEC = 0.03;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
const normalizeRadians = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
const rotateVector = (x: number, y: number, angle: number) => {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return new b2Vec2(x * c - y * s, x * s + y * c);
};

/**
 * Bendy twig made from rigid segments connected by soft weld joints.
 */
export class Twig {
  private readonly world: b2World;
  private readonly totalLength: number;
  private readonly visualThickness: number;
  private readonly segmentCount: number;
  private readonly segmentLength: number;
  private readonly fixtureThickness: number;
  private readonly bodies: b2Body[] = [];
  private readonly joints: b2WeldJoint[] = [];
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
    const segmentMass = Math.max(0.001, this.tuning.mass) / this.segmentCount;
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

    const weldProfile = this.computeWeldProfile();
    for (let i = 0; i < this.bodies.length - 1; i += 1) {
      const bodyA = this.bodies[i];
      const bodyB = this.bodies[i + 1];
      const localAnchorX = -halfLength + this.segmentLength * (i + 1);
      const anchorOffset = rotateVector(localAnchorX, 0, initialAngle);
      const anchor = new b2Vec2(startPos.x + anchorOffset.x, startPos.y + anchorOffset.y);
      const jointDef = new b2WeldJointDef();
      jointDef.Initialize(bodyA, bodyB, anchor);
      jointDef.collideConnected = false;
      b2AngularStiffness(jointDef, weldProfile.frequencyHz, weldProfile.dampingRatio, bodyA, bodyB);

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

  private computeWeldProfile() {
    const userStiffness = Number.isFinite(this.tuning.weldStiffness) ? Math.max(0, this.tuning.weldStiffness) : 0;
    const userDamping = Number.isFinite(this.tuning.weldDamping) ? Math.max(0, this.tuning.weldDamping) : 0;
    const angleLimitDeg = clamp(Math.abs(this.tuning.angleLimitDeg), 0.1, MAX_ABS_ANGLE_LIMIT_DEG);

    // Smaller angle limits imply a stiffer beam, larger limits imply more flexibility.
    const flexibilityFactor = Math.pow(clamp(angleLimitDeg / 15, 0.2, 8), 0.65);
    const frequencyHz = clamp((userStiffness * 0.12) / flexibilityFactor, 0, 30);
    const dampingRatio = clamp(userDamping * 0.06 + 0.05, 0, 8);
    return {
      frequencyHz,
      dampingRatio,
    };
  }

  private applyMassDistribution() {
    const totalMass = Number.isFinite(this.tuning.mass) ? Math.max(0.001, this.tuning.mass) : DEFAULT_TWIG_TUNING.mass;
    const targetSegmentMass = totalMass / Math.max(1, this.bodies.length);

    for (const body of this.bodies) {
      const currentMass = Math.max(body.GetMass(), 0.0001);
      const scale = targetSegmentMass / currentMass;
      const massData = body.GetMassData(new b2MassData());
      massData.mass = targetSegmentMass;
      massData.I *= scale;
      body.SetMassData(massData);
      body.SetAwake(true);
    }
  }

  public setTuning(tuning: Partial<TwigTuning>) {
    this.tuning = {
      ...this.tuning,
      ...tuning,
    };
    this.applyMassDistribution();
    const weldProfile = this.computeWeldProfile();
    for (const body of this.bodies) {
      body.SetAngularDamping(this.getSafeAngularDamping());
    }
    for (let i = 0; i < this.joints.length; i += 1) {
      const bodyA = this.bodies[i];
      const bodyB = this.bodies[i + 1];
      const stiffnessDef = { stiffness: 0, damping: 0 };
      b2AngularStiffness(stiffnessDef, weldProfile.frequencyHz, weldProfile.dampingRatio, bodyA, bodyB);
      this.joints[i].SetStiffness(stiffnessDef.stiffness);
      this.joints[i].SetDamping(stiffnessDef.damping);
    }
  }

  public updateSoftness(stepSeconds = DEFAULT_STEP_SECONDS) {
    const angleLimit = this.getSafeAngleLimitRadians();
    const userStiffness = Number.isFinite(this.tuning.weldStiffness) ? Math.max(0, this.tuning.weldStiffness) : 0;
    const userDamping = Number.isFinite(this.tuning.weldDamping) ? Math.max(0, this.tuning.weldDamping) : 0;
    const limitSpring = clamp(userStiffness * 1.1 + 2, 2, 500);
    const limitDamping = clamp(userDamping * 0.7 + 0.2, 0.2, 120);
    const maxLimitTorque = clamp(0.4 + userStiffness * 0.6 + userDamping * 0.8, 0.4, 300);

    for (let i = 0; i < this.bodies.length - 1; i += 1) {
      const bodyA = this.bodies[i];
      const bodyB = this.bodies[i + 1];
      const relativeAngle = normalizeRadians(bodyB.GetAngle() - bodyA.GetAngle());
      const relativeAngularVelocity = bodyB.GetAngularVelocity() - bodyA.GetAngularVelocity();
      const overLimit = Math.abs(relativeAngle) - angleLimit;

      if (overLimit <= LIMIT_DEADBAND_RAD && Math.abs(relativeAngularVelocity) < LIMIT_SPEED_DEADBAND_RAD_PER_SEC) {
        continue;
      }
      if (overLimit <= 0) {
        continue;
      }

      const direction = Math.sign(relativeAngle) || 1;
      const correction = direction * overLimit;
      const rawTorque = -(correction * limitSpring + relativeAngularVelocity * limitDamping) * stepSeconds;
      const torque = clamp(rawTorque, -maxLimitTorque, maxLimitTorque);

      bodyA.ApplyTorque(-torque, true);
      bodyB.ApplyTorque(torque, true);
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
