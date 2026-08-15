import * as CANNON from "cannon-es";
import {
    HALF_L, HALF_W, CUSHION_HEIGHT, RAIL_THICKNESS, TABLE_SURFACE_Y,
    BALL_RADIUS, BALL_MASS, BALL_LINEAR_DAMPING, BALL_ANGULAR_DAMPING,
    CORNER_GAP, SIDE_GAP, POCKETS, POCKET_RADIUS, MOVING_THRESHOLD, GRAVITY
} from "./constants.js";

// Builds and owns the Cannon-es world: table slate, cushions (with notches at
// each pocket so balls can fall through), and the 16 ball bodies. Pockets are
// implemented as simple radius-trigger checks (mirrors the original 2D game's
// isInsideHole approach) rather than true funnel geometry -- much cheaper and
// plenty convincing for a browser pool game.
export class PhysicsWorld {
    // Sets up an empty Cannon-es world with gravity, a broadphase (the
    // algorithm that quickly narrows down which body pairs might be
    // colliding, before doing the expensive exact check), and the three
    // "materials" (cloth, ball, cushion) whose pairwise friction/bounciness
    // are defined right below -- these are what make balls roll to a stop on
    // felt but bounce firmly off a rail. Then builds the static table
    // geometry (slate + cushions); ball bodies are added later one at a time
    // via createBall() once the rack layout is known.
    constructor() {
        this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, GRAVITY, 0) });
        this.world.broadphase = new CANNON.SAPBroadphase(this.world);
        this.world.allowSleep = true;

        this.clothMaterial = new CANNON.Material("cloth");
        this.ballMaterial = new CANNON.Material("ball");
        this.cushionMaterial = new CANNON.Material("cushion");

        // Ball-vs-ball: low friction, high restitution -- pool balls click and
        // deflect crisply off each other rather than dragging or thudding.
        this.world.addContactMaterial(new CANNON.ContactMaterial(this.ballMaterial, this.ballMaterial, {
            friction: 0.15, restitution: 0.93
        }));
        // Ball-vs-cloth: higher friction (rolling resistance) and almost no
        // bounce, since the ball is resting on the table, not colliding with it.
        this.world.addContactMaterial(new CANNON.ContactMaterial(this.ballMaterial, this.clothMaterial, {
            friction: 0.55, restitution: 0.2
        }));
        // Ball-vs-cushion: bounces back firmly off the rail, with a bit of
        // friction so shots off the cushion lose some energy like real felt-lined rails.
        this.world.addContactMaterial(new CANNON.ContactMaterial(this.ballMaterial, this.cushionMaterial, {
            friction: 0.25, restitution: 0.82
        }));

        this.balls = new Map(); // id -> CANNON.Body
        this.cushionBodies = new Set(); // tracked so contact events can tell "hit a rail" from "hit the slate"
        this._buildSlate();
        this._buildCushions();
    }

    // The playing surface itself: an infinite static physics plane (mass 0 =
    // immovable) rotated flat and raised to table height. Balls simply rest on
    // top of it; it has no visual representation (TableScene draws the felt separately).
    _buildSlate() {
        const slate = new CANNON.Body({ mass: 0, material: this.clothMaterial });
        slate.addShape(new CANNON.Plane());
        slate.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
        slate.position.set(0, TABLE_SURFACE_Y, 0);
        this.world.addBody(slate);
    }

    // Helper that adds one static box-shaped cushion segment to the world.
    // _buildCushions() below calls this multiple times to assemble the full
    // rail out of separate segments with gaps left at the pockets.
    _addCushionBox(halfExtents, position) {
        const body = new CANNON.Body({ mass: 0, material: this.cushionMaterial });
        body.addShape(new CANNON.Box(new CANNON.Vec3(halfExtents.x, halfExtents.y, halfExtents.z)));
        body.position.set(position.x, TABLE_SURFACE_Y + CUSHION_HEIGHT / 2, position.z);
        this.world.addBody(body);
        this.cushionBodies.add(body);
        return body;
    }

    // Whether a given physics body is one of the rail segments -- used to
    // detect "a ball hit a cushion" for the legal-shot rule (see Rules.js).
    isCushion(body) {
        return this.cushionBodies.has(body);
    }

    _buildCushions() {
        const h = CUSHION_HEIGHT / 2;
        const t = RAIL_THICKNESS;

        // Long rails run along X, sit at z = +-HALF_W, split around the side pocket gap.
        // Each half-segment runs from the side-pocket notch out to the corner-pocket
        // notch -- NOT divided by 2 again, or it leaves a huge unguarded gap between
        // the segment's end and the actual corner (balls would roll straight off the
        // table there instead of being stopped by a cushion or caught by a pocket).
        const longSegLen = HALF_L - CORNER_GAP - SIDE_GAP;
        [-1, 1].forEach((zSign) => {
            [-1, 1].forEach((xSign) => {
                const centerX = xSign * (SIDE_GAP + longSegLen / 2);
                this._addCushionBox(
                    { x: longSegLen / 2, y: h, z: t / 2 },
                    { x: centerX, z: zSign * (HALF_W + t / 2 - 0.01) }
                );
            });
        });

        // Short rails run along Z, sit at x = +-HALF_L, single segment between the two corner gaps.
        const shortSegLen = (HALF_W * 2) - (CORNER_GAP * 2);
        [-1, 1].forEach((xSign) => {
            this._addCushionBox(
                { x: t / 2, y: h, z: shortSegLen / 2 },
                { x: xSign * (HALF_L + t / 2 - 0.01), z: 0 }
            );
        });
    }

    // Creates one ball's physics body (a sphere) at the given table position and
    // registers it under `id` so it can be looked up/removed later. Used both
    // for the 16 real balls in a match and, by AIOpponent.js, for throwaway
    // balls in a headless "what if I hit it this way" simulation.
    createBall(id, x, z) {
        const body = new CANNON.Body({
            mass: BALL_MASS,
            material: this.ballMaterial,
            shape: new CANNON.Sphere(BALL_RADIUS),
            linearDamping: BALL_LINEAR_DAMPING,
            angularDamping: BALL_ANGULAR_DAMPING
        });
        body.position.set(x, TABLE_SURFACE_Y + BALL_RADIUS + 0.001, z);
        body.allowSleep = true;
        body.sleepSpeedLimit = MOVING_THRESHOLD;
        body.sleepTimeLimit = 0.25;
        // Continuous collision detection: a fast ball (break shot, hard hits) can
        // otherwise travel farther than its own radius in a single physics step and
        // tunnel straight through a cushion or a pocket-gap edge without ever being
        // sampled inside it. Sweeping a sphere each step catches that.
        body.ccdSpeedThreshold = BALL_RADIUS;
        body.ccdSweptSphereRadius = BALL_RADIUS * 0.9;
        this.world.addBody(body);
        this.balls.set(id, body);
        return body;
    }

    // Takes a ball fully out of the simulation -- used when it's potted, so it
    // no longer participates in collisions or gets stepped/rendered.
    removeBall(id) {
        const body = this.balls.get(id);
        if (body) {
            this.world.removeBody(body);
            this.balls.delete(id);
        }
    }

    // Teleports a ball (still in the world) to a new resting position with zero
    // velocity/spin -- used for racking balls, ball-in-hand placement, and
    // snapping a multiplayer client's balls to the host's authoritative positions.
    resetBall(body, x, z) {
        body.velocity.setZero();
        body.angularVelocity.setZero();
        body.position.set(x, TABLE_SURFACE_Y + BALL_RADIUS + 0.001, z);
        body.quaternion.set(0, 0, 0, 1);
        body.wakeUp();
    }

    // Strikes a ball (always the cue ball, in practice) in the given horizontal
    // direction with the given strength -- this is what actually "shoots" the
    // cue ball when the player releases their charged-up shot.
    applyCueImpulse(body, dirX, dirZ, magnitude) {
        body.wakeUp();
        const impulse = new CANNON.Vec3(dirX * magnitude, 0, dirZ * magnitude);
        // No offset point passed -> impulse applies at the center of mass (no spurious torque).
        body.applyImpulse(impulse);
    }

    // Advances the simulation. Cannon-es internally uses a fixed 1/120s
    // physics step for stability/determinism, but takes `dt` (the real time
    // since last frame, e.g. ~1/60s) and figures out how many of those fixed
    // steps to run to catch up, up to 5 per call so a slow frame can't spiral
    // into simulating minutes of physics at once.
    step(dt) {
        this.world.step(1 / 120, dt, 5);
    }

    // A ball counts as "moving" if it's still translating or spinning faster
    // than the resting threshold -- used to decide when a shot has fully
    // settled and it's time to resolve fouls/pots/whose turn is next.
    isMoving(body) {
        return body.velocity.length() > MOVING_THRESHOLD || body.angularVelocity.length() > MOVING_THRESHOLD * 4;
    }

    // True while any ball on the table is still moving from the last shot.
    anyMoving() {
        for (const body of this.balls.values()) {
            if (this.isMoving(body)) return true;
        }
        return false;
    }

    // Returns the pocket a ball currently sits over, or null.
    pocketAt(x, z) {
        for (const p of POCKETS) {
            const dx = x - p.x;
            const dz = z - p.z;
            if (Math.sqrt(dx * dx + dz * dz) < POCKET_RADIUS) return p.name;
        }
        return null;
    }

    // Swept version of pocketAt: checks the whole segment a ball traveled this
    // step, not just its endpoint. A fast ball can hop clean over the capture
    // radius between two single-point samples and appear to fly off the table
    // uncaptured -- sampling the path it swept through closes that gap.
    pocketAlongPath(x1, z1, x2, z2) {
        for (const p of POCKETS) {
            const dx = x2 - x1;
            const dz = z2 - z1;
            const lenSq = dx * dx + dz * dz;
            let t = lenSq > 0 ? ((p.x - x1) * dx + (p.z - z1) * dz) / lenSq : 0;
            t = Math.max(0, Math.min(1, t));
            const cx = x1 + t * dx;
            const cz = z1 + t * dz;
            const ddx = cx - p.x;
            const ddz = cz - p.z;
            if (Math.sqrt(ddx * ddx + ddz * ddz) < POCKET_RADIUS) return p.name;
        }
        return null;
    }
}
