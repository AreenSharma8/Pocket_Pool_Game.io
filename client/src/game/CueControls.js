import * as THREE from "three";
import { BALL_RADIUS, CUE_MAX_IMPULSE, TABLE_SURFACE_Y } from "./constants.js";

const CHARGE_RATE = 1.0 / 1.1; // full charge (0->1) over ~1.1s of holding
const CAM_RADIUS = 1.7;
const CAM_HEIGHT = 1.55;

// Left-drag on the canvas rotates the aim direction around the cue ball.
// Right-drag (or two-finger drag) orbits the viewing camera around the table.
// Holding Space or the on-screen "HOLD TO SHOOT" button charges power; release fires.
export class CueControls {
    // `options.onShoot(angle, power)` is called when the player releases a
    // charged shot. `options.canShoot()` is asked before letting the player
    // start charging at all -- PoolMatch uses it to block shooting when it's
    // not this player's turn, the balls are still moving, etc.
    constructor(canvas, tableScene, options) {
        this.canvas = canvas;
        this.tableScene = tableScene;
        this.onShoot = options.onShoot;
        this.canShoot = options.canShoot || (() => true);

        // Default aim points from the cue ball's break position toward the rack
        // (+X), so the stick and camera start facing the balls instead of sideways.
        this.aimAngle = Math.PI / 2;
        this.cameraOrbit = 0;
        this.power = 0;
        this.charging = false;
        this.dragging = null; // "aim" | "orbit"
        this.lastX = 0;

        this.cueBallPos = new THREE.Vector3();

        this._buildCueMesh();
        this._bindEvents();

        this.powerFillEl = document.querySelector(".power-meter-fill");
    }

    _buildCueMesh() {
        const group = new THREE.Group();
        // radiusTop is the far/butt end (thick, held by the player), radiusBottom is
        // the near/tip end (thin, touches the cue ball) -- translate(0, 0.45, 0)
        // brings radiusBottom to the local origin, which is the pivot placed right
        // behind the ball, so the tip must be the thin one or the stick looks reversed.
        const geo = new THREE.CylinderGeometry(0.012, 0.006, 0.9, 16);
        geo.translate(0, 0.45, 0); // pivot at the tip
        geo.rotateX(Math.PI / 2);
        const mat = new THREE.MeshStandardMaterial({ color: 0xdcb98a, roughness: 0.4 });
        const stick = new THREE.Mesh(geo, mat);
        stick.castShadow = true;
        group.add(stick);
        this.cueMesh = group;
        this.tableScene.scene.add(group);

        // Dashed guide line from the cue ball out to where it's aimed, so the
        // player can see the shot line before committing to a shot.
        const lineGeo = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(0, 0, 1.6)
        ]);
        const lineMat = new THREE.LineDashedMaterial({ color: 0xf2b705, dashSize: 0.04, gapSize: 0.03, transparent: true, opacity: 0.85 });
        this.aimLine = new THREE.Line(lineGeo, lineMat);
        this.aimLine.computeLineDistances();
        this.tableScene.scene.add(this.aimLine);
    }

    // Wires up all mouse/touch/keyboard input. Left-drag (or a single
    // finger) steers aimAngle; right-drag steers cameraOrbit on desktop, but
    // touch has no "right button", so a second finger down switches an
    // in-progress touch-drag to orbit instead -- the common two-finger-orbit
    // gesture -- and dropping back to one finger returns to aiming.
    // Space bar and the on-screen touch button both charge/release the shot the same way.
    _bindEvents() {
        this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
        this.activePointers = new Map(); // pointerId -> last known clientX, for multi-touch orbit detection

        this.canvas.addEventListener("pointerdown", (e) => {
            this.activePointers.set(e.pointerId, e.clientX);
            this.canvas.setPointerCapture(e.pointerId);
            this.dragging = (e.button === 2 || this.activePointers.size >= 2) ? "orbit" : "aim";
            this.lastX = e.clientX;
        });

        window.addEventListener("pointermove", (e) => {
            if (!this.dragging) return;
            if (this.activePointers.has(e.pointerId)) this.activePointers.set(e.pointerId, e.clientX);
            const dx = e.clientX - this.lastX;
            this.lastX = e.clientX;
            const delta = dx * 0.006;
            if (this.dragging === "aim") this.aimAngle -= delta;
            else this.cameraOrbit -= delta;
        });

        window.addEventListener("pointerup", (e) => {
            this.activePointers.delete(e.pointerId);
            if (this.activePointers.size === 0) {
                this.dragging = null;
            } else {
                // Dropped from two fingers back to one -- resume aiming with
                // whichever finger is still down, resetting lastX so its
                // remembered position doesn't cause a sudden jump.
                this.dragging = "aim";
                this.lastX = [...this.activePointers.values()][0];
            }
        });

        window.addEventListener("keydown", (e) => {
            if (e.code === "Space") { e.preventDefault(); this._startCharge(); }
        });
        window.addEventListener("keyup", (e) => {
            if (e.code === "Space") { e.preventDefault(); this._release(); }
        });

        const shootBtn = document.getElementById("hold-to-shoot");
        if (shootBtn) {
            shootBtn.addEventListener("pointerdown", (e) => { e.preventDefault(); this._startCharge(); });
            window.addEventListener("pointerup", () => this._release());
        }
    }

    // Begins ramping the power meter up, but only if the game currently
    // allows this player to shoot (see the canShoot() callback above).
    _startCharge() {
        if (!this.canShoot() || this.charging) return;
        this.charging = true;
    }

    // Stops charging and, if enough power built up, actually fires the shot
    // by calling onShoot() with the current aim angle and power (0-1).
    _release() {
        if (!this.charging) return;
        this.charging = false;
        const power = this.power;
        this.power = 0;
        if (power > 0.04 && this.onShoot) {
            this.onShoot(this.aimAngle, power);
        }
    }

    // Tells this control where the cue ball currently is, so the stick/aim
    // line/camera can be positioned relative to it. Called once at rack time
    // and then every frame from PoolMatch's loop so the stick follows the
    // cue ball wherever it ends up rolling to after a shot.
    setCueBallPosition(x, z) {
        this.cueBallPos.set(x, TABLE_SURFACE_Y + BALL_RADIUS, z);
    }

    // Shows/hides the stick and aim line -- disabled while it's not this
    // player's turn, while a shot is still resolving, or while the AI is thinking.
    setEnabled(enabled) {
        this.enabled = enabled;
        this.cueMesh.visible = enabled;
        this.aimLine.visible = enabled;
    }

    // Called every frame. Ramps up the power meter while charging, and
    // repositions the camera, cue stick, and aim guide line to match the
    // current aim angle and cue ball position.
    update(dt) {
        if (this.charging) {
            this.power = Math.min(1, this.power + dt * CHARGE_RATE);
        }
        if (this.powerFillEl) {
            this.powerFillEl.style.width = `${Math.round(this.power * 100)}%`;
        }

        // Camera sits on the opposite side of the table from the aim target -- i.e.
        // roughly behind the shooter -- looking toward what's being aimed at, the
        // way a real player would sight down the cue rather than facing it.
        const camAngle = this.cameraOrbit + this.aimAngle + Math.PI;
        const camX = Math.sin(camAngle) * CAM_RADIUS;
        const camZ = Math.cos(camAngle) * CAM_RADIUS;
        this.tableScene.camera.position.set(camX, TABLE_SURFACE_Y + CAM_HEIGHT, camZ);
        this.tableScene.camera.lookAt(0, TABLE_SURFACE_Y, 0);

        // Cue stick sits behind the cue ball along the aim direction, pulling back with power.
        // Its shaft geometry extends from the tip (local origin) toward +Z, so the group must
        // face *away* from the ball (angle + PI) or the shaft would run forward through the ball.
        const dirX = Math.sin(this.aimAngle);
        const dirZ = Math.cos(this.aimAngle);
        const pullback = 0.09 + this.power * 0.24;
        this.cueMesh.position.set(
            this.cueBallPos.x - dirX * (BALL_RADIUS + pullback),
            this.cueBallPos.y,
            this.cueBallPos.z - dirZ * (BALL_RADIUS + pullback)
        );
        this.cueMesh.rotation.set(0, Math.atan2(dirX, dirZ) + Math.PI, 0);

        // Aim guide extends forward from the ball surface in the direction of the shot.
        this.aimLine.position.set(
            this.cueBallPos.x + dirX * BALL_RADIUS,
            this.cueBallPos.y,
            this.cueBallPos.z + dirZ * BALL_RADIUS
        );
        this.aimLine.rotation.set(0, Math.atan2(dirX, dirZ), 0);
    }

    // Converts the current aim angle into a horizontal unit direction vector
    // (not currently used outside this file, but handy for anyone extending it).
    aimDirection() {
        return { x: Math.sin(this.aimAngle), z: Math.cos(this.aimAngle) };
    }

    // Converts a normalized power (0-1, from how long Space was held) into the
    // actual physics impulse strength -- shared by real shots and the AI's
    // simulated ones so both use the exact same power scale.
    static impulseForPower(power) {
        return power * CUE_MAX_IMPULSE;
    }
}
