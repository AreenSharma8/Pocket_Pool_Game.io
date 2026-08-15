import * as THREE from "three";
import { PhysicsWorld } from "./PhysicsWorld.js";
import { TableScene } from "./TableScene.js";
import { CueControls } from "./CueControls.js";
import { Rules } from "./Rules.js";
import { AIOpponent } from "./AIOpponent.js";
import {
    SUIT, BALL_RADIUS, DEFAULT_CUE_BALL_POS, RACK_APEX, TABLE_SURFACE_Y,
    HALF_L, HALF_W, CUE_MAX_IMPULSE, BLACK_RESPOT
} from "./constants.js";

const AUDIO_BASE = "assets/sounds/";
function loadAudio(name) {
    try { return new Audio(AUDIO_BASE + name); } catch { return null; }
}

// Orchestrates one match: physics stepping, rendering, rules, cue input, and
// (for single-player) the AI opponent. Multiplayer reuses this same class --
// see applyRemoteShot()/isLocalTurn() -- with the network layer deciding when
// a locally-charged shot is actually applied (see MultiplayerGameScreen).
export class PoolMatch {
    // opts:
    //   mode            "single" (vs AI) or "multi" (networked)
    //   playerIds       ordered list of player ids (2 for single player, 2-4 for multiplayer)
    //   localPlayerId   which of playerIds is "me" on this device
    //   difficulty      AI difficulty config, single-player only
    //   isHost          multiplayer only -- whether this client's physics is authoritative
    //   rackOrder       multiplayer only -- server-generated suit shuffle, so every client racks identically
    //   network         multiplayer only -- see the wiring further down for the exact shape
    //   onTurnChange / onGameOver / onFoulToast   callbacks the hosting screen (SinglePlayerGameScreen /
    //                   MultiplayerGameScreen) uses to update its HUD
    constructor(canvas, opts) {
        this.canvas = canvas;
        this.mode = opts.mode; // "single" | "multi"
        this.playerIds = opts.playerIds;
        this.playerNames = opts.playerNames || opts.playerIds;
        this.localPlayerId = opts.localPlayerId;
        this.difficulty = opts.difficulty;
        this.onTurnChange = opts.onTurnChange || (() => {});
        this.onGameOver = opts.onGameOver || (() => {});
        this.onFoulToast = opts.onFoulToast || (() => {});
        this.network = opts.network || null; // { sendShot, onShot, sendPlacement, onPlacement, sendSkipTurn }
        this.isHost = !!opts.isHost;
        this.rackOrder = opts.rackOrder || null;

        this.physics = new PhysicsWorld();
        this.scene = new TableScene(canvas);
        this.rules = new Rules(this.playerIds);

        this.balls = new Map();
        this.bodyToId = new Map();
        this.movingLastFrame = false;
        this.awaitingResolve = false;   // true while a shot's balls are still settling
        this.awaitingPlacement = false; // true while the current player has ball-in-hand after a foul
        this.aiThinking = false;        // true while the AI's shot search is running (single-player)
        this.destroyed = false;
        this.disconnectedPlayers = new Set();

        this.sounds = {
            strike: loadAudio("Strike.wav"),
            collide: loadAudio("BallsCollide.wav"),
            hole: loadAudio("Hole.wav")
        };

        this.cueControls = new CueControls(canvas, this.scene, {
            onShoot: (angle, power) => this._onLocalCueRelease(angle, power),
            canShoot: () => this.isLocalTurn() && !this.awaitingResolve && !this.awaitingPlacement && !this.aiThinking
        });

        this._rack();
        this._bindContactEvents();
        this._bindPlacementClick();

        // Multiplayer network wiring: every client (including the shooter)
        // only actually fires a shot once it's echoed back by the server --
        // this keeps every client applying the exact same impulse at the same
        // logical moment (see _onLocalCueRelease below).
        if (this.network && this.network.onShot) {
            this.network.onShot((shot) => this._applyImpulse(shot.angle, shot.power));
        }
        if (this.network && this.network.onPlacement) {
            this.network.onPlacement((pos) => this._placeCueBall(pos.x, pos.z, true));
        }
        // The host's physics resolution is authoritative -- independent client-side
        // simulations of the same 16-ball collision will diverge in real time (tiny
        // float/order differences compound fast in a chaotic scatter), so guests snap
        // to whatever the host reports instead of trusting their own local outcome.
        if (this.network && this.network.onTurnResult) {
            this.network.onTurnResult((result) => { if (!this.isHost) this._applyAuthoritativeResult(result); });
        }

        this.cueControls.setEnabled(this.isLocalTurn());
        this.raf = requestAnimationFrame((t) => this._loop(t));
        this._announceTurn();
    }

    // Places the 15 object balls in the standard triangular rack (apex nearest
    // the cue ball, black ball dead center of the third row) plus the cue ball
    // at its break position, and creates a physics body + visible mesh for each.
    _rack() {
        // Multiplayer passes a rackOrder generated once by the server so every
        // client racks the identical red/yellow layout -- otherwise each client's
        // own Math.random() shuffle would disagree about which physical ball is
        // which suit, and the rules engine would desync the moment one gets potted.
        let suits = this.rackOrder;
        if (!suits) {
            suits = [];
            for (let i = 0; i < 7; i++) suits.push(SUIT.RED);
            for (let i = 0; i < 7; i++) suits.push(SUIT.YELLOW);
            for (let i = suits.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [suits[i], suits[j]] = [suits[j], suits[i]];
            }
        }

        const rowSpacing = BALL_RADIUS * 2 * 0.87;
        const colSpacing = BALL_RADIUS * 2 * 1.01;
        let suitIdx = 0;
        let ballIdx = 0;

        // Standard 5-row triangle: row 0 is the single apex ball, row 4 is the
        // back row of 5. The center slot of the middle (3rd) row always holds
        // the black ball, matching a real rack.
        for (let row = 0; row < 5; row++) {
            for (let col = 0; col <= row; col++) {
                const x = RACK_APEX.x + row * rowSpacing;
                const z = RACK_APEX.z + (col - row / 2) * colSpacing;
                const isCenter = row === 2 && col === 1;
                const suit = isCenter ? SUIT.BLACK : suits[suitIdx++];
                const id = suit === SUIT.BLACK ? "black" : `${suit}${ballIdx++}`;
                this._addBall(id, suit, x, z);
            }
        }

        this._addBall("white", SUIT.WHITE, DEFAULT_CUE_BALL_POS.x, DEFAULT_CUE_BALL_POS.z);
        this.cueControls.setCueBallPosition(DEFAULT_CUE_BALL_POS.x, DEFAULT_CUE_BALL_POS.z);
    }

    // Creates one ball's physics body + mesh and registers it in this match's
    // bookkeeping maps (`balls` by game id, `bodyToId` for the reverse lookup
    // collision events need).
    _addBall(id, suit, x, z) {
        const body = this.physics.createBall(id, x, z);
        this.scene.addBallMesh(id, suit);
        this.balls.set(id, { suit, body, potted: false, lastX: x, lastZ: z });
        this.bodyToId.set(body, id);
    }

    // Listens for physics collisions to (a) record which suit the cue ball hit
    // first this turn, for foul checking, (b) play the click sound whenever
    // two balls touch, and (c) tell the rules engine whenever any ball
    // touches a cushion, which satisfies the "legal shot" requirement that
    // something happen after the initial contact (a pot, or a rail touch).
    _bindContactEvents() {
        this.physics.world.addEventListener("beginContact", (evt) => {
            if (this.physics.isCushion(evt.bodyA) || this.physics.isCushion(evt.bodyB)) {
                this.rules.onRailContact();
            }

            const idA = this.bodyToId.get(evt.bodyA);
            const idB = this.bodyToId.get(evt.bodyB);
            if (!idA || !idB) return;

            if (idA === "white" || idB === "white") {
                const other = idA === "white" ? idB : idA;
                const otherBall = this.balls.get(other);
                if (otherBall) this.rules.onFirstContact(otherBall.suit);
            }

            if (this.sounds.collide) {
                const c = this.sounds.collide.cloneNode(true);
                c.volume = 0.5;
                c.play().catch(() => {});
            }
        });
    }

    // Wires up "ball in hand" placement: while awaitingPlacement is true and
    // it's this player's turn, clicking the table casts a ray from the camera
    // through the click point onto the table's plane to find the 3D spot the
    // player clicked, then attempts to place the cue ball there.
    _bindPlacementClick() {
        this.raycaster = new THREE.Raycaster();
        this.tablePlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -TABLE_SURFACE_Y);
        this.canvas.addEventListener("click", (e) => {
            if (!this.awaitingPlacement || !this.isLocalTurn()) return;
            const rect = this.canvas.getBoundingClientRect();
            const ndc = new THREE.Vector2(
                ((e.clientX - rect.left) / rect.width) * 2 - 1,
                -((e.clientY - rect.top) / rect.height) * 2 + 1
            );
            this.raycaster.setFromCamera(ndc, this.scene.camera);
            const point = new THREE.Vector3();
            if (this.raycaster.ray.intersectPlane(this.tablePlane, point)) {
                this._tryPlaceCueBall(point.x, point.z);
            }
        });
    }

    // Validates a proposed ball-in-hand spot: must be inside the rails, not
    // over a pocket, and not overlapping another ball. Only calls
    // _placeCueBall() (which actually moves the ball and broadcasts it) if valid.
    _tryPlaceCueBall(x, z) {
        const margin = BALL_RADIUS * 1.2;
        if (Math.abs(x) > HALF_L - margin || Math.abs(z) > HALF_W - margin) return;
        if (this.physics.pocketAt(x, z)) return;
        for (const [id, b] of this.balls) {
            if (id === "white" || b.potted) continue;
            const dx = b.body.position.x - x;
            const dz = b.body.position.z - z;
            if (Math.sqrt(dx * dx + dz * dz) < BALL_RADIUS * 2.1) return;
        }
        this._placeCueBall(x, z, false);
    }

    // Actually moves the cue ball to (x, z), makes it visible/active again,
    // and clears ball-in-hand mode. `fromNetwork` distinguishes "I clicked
    // this myself" (broadcast it to other players) from "a network message
    // told me the cue ball was placed here" (don't re-broadcast, or every
    // client would echo it back and forth forever).
    _placeCueBall(x, z, fromNetwork) {
        const ball = this.balls.get("white");
        this.physics.resetBall(ball.body, x, z);
        ball.potted = false;
        ball.lastX = x;
        ball.lastZ = z;
        this.scene.setBallVisible("white", true);
        this.cueControls.setCueBallPosition(x, z);
        this.awaitingPlacement = false;
        this.cueControls.setEnabled(this.isLocalTurn());
        if (!fromNetwork && this.network && this.network.sendPlacement) {
            this.network.sendPlacement({ x, z });
        }
    }

    // Whether it's this device's player's turn right now.
    isLocalTurn() {
        return this.rules.currentPlayerId === this.localPlayerId;
    }

    // Called when the local player releases a charged shot. In single-player
    // (or as the shooter in multiplayer), the impulse is applied immediately;
    // in multiplayer it's sent to the server instead, and *every* client
    // (including this one) only actually fires the shot once the server
    // echoes it back via the onShot handler wired in the constructor -- this
    // is what keeps all clients' physics starting from the exact same trigger point.
    _onLocalCueRelease(angle, power) {
        if (this.mode === "multi" && this.network) {
            this.network.sendShot({ angle, power });
        } else {
            this._applyImpulse(angle, power);
        }
    }

    // Actually strikes the cue ball: resets this turn's rules tracking, hits
    // it with a physics impulse in the given direction/power, plays the
    // strike sound, hides the cue stick, and marks the match as "waiting for
    // the balls to stop moving" so _loop() knows to resolve the turn once they do.
    _applyImpulse(angle, power) {
        if (this.awaitingResolve) return;
        this.rules.onShotStart();
        const cue = this.balls.get("white");
        const dirX = Math.sin(angle);
        const dirZ = Math.cos(angle);
        this.physics.applyCueImpulse(cue.body, dirX, dirZ, CueControls.impulseForPower(power));
        if (this.sounds.strike) {
            const s = this.sounds.strike.cloneNode(true);
            s.volume = Math.min(1, 0.3 + power * 0.7);
            s.play().catch(() => {});
        }
        this.cueControls.setEnabled(false);
        this.awaitingResolve = true;
        this.movingLastFrame = true;
    }

    // The main per-frame update, driven by requestAnimationFrame. Every frame:
    // step physics forward, check for newly-potted balls, move every ball
    // mesh to match its physics body, keep the cue stick following the cue
    // ball, update/render the cue controls and scene, and -- once a shot has
    // fully settled -- resolve what happened.
    _loop(t) {
        if (this.destroyed) return;
        const dt = Math.min((t - (this._lastT || t)) / 1000, 1 / 30);
        this._lastT = t;

        this.physics.step(dt || 1 / 60);
        this._checkPockets();

        for (const [id, b] of this.balls) {
            if (!b.potted) this.scene.syncBallMesh(id, b.body);
        }

        // Keep the cue stick/aim line following the cue ball's actual live position
        // every frame -- otherwise, once the cue ball rolls somewhere new after a
        // shot, the stick stays pinned wherever it was at the start of the game.
        const cueBall = this.balls.get("white");
        if (cueBall && !cueBall.potted) {
            this.cueControls.setCueBallPosition(cueBall.body.position.x, cueBall.body.position.z);
        }

        this.cueControls.update(dt || 0);
        this.scene.render();

        if (this.awaitingResolve && !this.physics.anyMoving()) {
            this.awaitingResolve = false;
            this._resolveShotEnd();
        }

        this.raf = requestAnimationFrame((t2) => this._loop(t2));
    }

    // Checks every ball still in play against the pockets (and the escape
    // safety net) each frame, and pots any that qualify: marks it potted,
    // tells the rules engine, hides its mesh/plays the sound, and removes it
    // from physics (the cue ball is instead just parked off-table, since it
    // comes back into play via ball-in-hand rather than staying "gone").
    _checkPockets() {
        for (const [id, b] of this.balls) {
            if (b.potted) continue;
            const pos = b.body.position;
            const prevX = b.lastX ?? pos.x;
            const prevZ = b.lastZ ?? pos.z;

            // Swept check: sample the whole path the ball moved this step, not just
            // its endpoint, so a fast ball can't hop clean over the capture radius
            // between two single-point samples and appear to fly off the table.
            const pocket = this.physics.pocketAlongPath(prevX, prevZ, pos.x, pos.z);

            // Escape safety net: a ball that somehow slipped past a cushion (not
            // through a pocket) is treated as potted rather than allowed to keep
            // rolling off into open space. Kept tight so it triggers right at the
            // rail rather than after the ball has visibly crossed the table edge.
            const escaped = !pocket && (Math.abs(pos.x) > HALF_L + 0.05 || Math.abs(pos.z) > HALF_W + 0.05 || pos.y < TABLE_SURFACE_Y - 0.4);

            b.lastX = pos.x;
            b.lastZ = pos.z;

            if (pocket) {
                b.potted = true;
                this.rules.onBallPotted(b.suit);
                this.scene.setBallVisible(id, false);
                if (this.sounds.hole) {
                    const h = this.sounds.hole.cloneNode(true);
                    h.volume = 0.6;
                    h.play().catch(() => {});
                }
                if (id !== "white") this.physics.removeBall(id);
                else this.physics.resetBall(b.body, -10, -10);
            } else if (escaped) {
                if (id === "white") {
                    // Scratch -- already a foul via cueBallPotted below regardless
                    // of pocket vs. escape, so this stays parked off-table until
                    // the fouled player places it back via ball-in-hand.
                    b.potted = true;
                    this.rules.onBallPotted(b.suit);
                    this.scene.setBallVisible(id, false);
                    this.physics.resetBall(b.body, -10, -10);
                } else {
                    // An object ball left the table without going through a
                    // pocket -- a foul, not a legal pot. It's never removed:
                    // just re-spotted right where it left, and stays in play.
                    this.rules.onBallEscaped();
                    this.physics.resetBall(b.body, prevX, prevZ);
                    b.lastX = prevX;
                    b.lastZ = prevZ;
                }
            }
        }
    }

    // Un-pots a ball: re-creates its physics body (a potted ball's old body
    // was fully removed from the world, so it can't just be repositioned)
    // and makes its mesh visible again. Used both when the black ball is
    // re-spotted after being potted on the break, and when a multiplayer
    // client has to revive a ball its own local physics wrongly potted (see
    // _applyAuthoritativeResult below).
    _reviveBall(id, x, z) {
        const b = this.balls.get(id);
        if (!b) return;
        const newBody = this.physics.createBall(id, x, z);
        this.bodyToId.delete(b.body);
        b.body = newBody;
        this.bodyToId.set(newBody, id);
        b.potted = false;
        b.lastX = x;
        b.lastZ = z;
        this.scene.setBallVisible(id, true);
    }

    // Called once a shot's balls have all stopped moving. Runs the rules
    // engine to find out what happened, reacts to it (foul toast, win
    // screen, re-enable the cue for whoever's turn it now is), and kicks off
    // the AI's turn if it's now their move in single-player.
    _resolveShotEnd() {
        // In multiplayer, only the host's resolution counts -- guests wait for the
        // host's broadcast (see onTurnResult wiring above) instead of computing
        // their own possibly-diverged outcome from their own local simulation.
        if (this.mode === "multi" && !this.isHost) return;

        const ballList = [...this.balls.entries()].map(([id, b]) => ({ id, suit: b.suit, potted: b.potted && id !== "white" }));
        const outcome = this.rules.resolveTurn(ballList);

        // 8-ball potted on the break doesn't end the game -- revive it before
        // building the network payload so guests see it back in play too.
        if (outcome.blackRespot) {
            this._reviveBall("black", BLACK_RESPOT.x, BLACK_RESPOT.z);
        }

        if (this.mode === "multi" && this.network && this.network.sendTurnResult) {
            this.network.sendTurnResult(this._buildResultPayload(outcome));
        }

        if (outcome.won) {
            this.cueControls.setEnabled(false);
            this.onGameOver(this.rules.winnerId);
            return;
        }

        if (outcome.foul) {
            this.onFoulToast("Foul! Ball in hand.");
            this.awaitingPlacement = true;
            this.cueControls.setEnabled(false);
        } else if (outcome.blackRespot) {
            this.onFoulToast("8-ball on the break — re-spotted, play continues.");
        }

        this._announceTurn();

        if (!outcome.foul && !this.awaitingPlacement) {
            this.cueControls.setEnabled(this.isLocalTurn());
        }

        if (this.mode === "single" && this.rules.currentPlayerId !== this.localPlayerId) {
            this._runAiTurn();
        }
    }

    // Packages up everything a guest needs to reproduce this shot's outcome
    // exactly, without re-simulating it themselves: every remaining ball's
    // final position, which balls got potted, and the resulting rules state
    // (foul/turn/scores/suits/game-over). Sent to the server, which relays it
    // to every other client.
    _buildResultPayload(outcome) {
        const positions = [];
        for (const [id, b] of this.balls) {
            if (!b.potted) positions.push({ id, x: b.body.position.x, z: b.body.position.z });
        }
        const pottedIds = [...this.balls.entries()]
            .filter(([id, b]) => b.potted && id !== "white")
            .map(([id]) => id);

        return {
            positions,
            pottedIds,
            foul: outcome.foul,
            gameOver: this.rules.gameOver,
            winnerId: this.rules.winnerId,
            turnIndex: this.rules.turnIndex,
            suits: Object.fromEntries(this.rules.suits),
            scores: Object.fromEntries(this.rules.scores)
        };
    }

    // Applied on every non-host client once the host's resolution arrives: snap
    // ball positions/pots and rules state to match exactly, then continue as normal.
    _applyAuthoritativeResult(result) {
        this.awaitingResolve = false;

        // A guest's own local physics may have potted a different set of balls than
        // the host did (independent simulations of a chaotic scatter diverge fast).
        // Reconcile fully in both directions: pot what the host potted, and revive
        // anything this client wrongly potted on its own that the host didn't.
        const authoritativePotted = new Set(result.pottedIds);
        for (const [id, b] of this.balls) {
            if (id === "white") continue;
            const shouldBePotted = authoritativePotted.has(id);
            if (shouldBePotted && !b.potted) {
                b.potted = true;
                this.scene.setBallVisible(id, false);
                this.physics.removeBall(id);
            } else if (!shouldBePotted && b.potted) {
                // This client thought the ball was potted but the host says
                // it's still in play -- revive it (exact position gets set by
                // the positions loop below).
                this._reviveBall(id, 0, 0);
            }
        }

        // Snap every still-in-play ball to the host's exact final position.
        result.positions.forEach((p) => {
            const b = this.balls.get(p.id);
            if (!b || b.potted) return;
            this.physics.resetBall(b.body, p.x, p.z);
            b.lastX = p.x;
            b.lastZ = p.z;
        });

        // Overwrite this client's rules state wholesale with the host's --
        // simpler and safer than trying to reconcile field-by-field.
        this.rules.turnIndex = result.turnIndex;
        this.rules.suits = new Map(Object.entries(result.suits));
        this.rules.scores = new Map(Object.entries(result.scores));
        this.rules.gameOver = result.gameOver;
        this.rules.winnerId = result.winnerId;

        if (result.gameOver) {
            this.cueControls.setEnabled(false);
            this.onGameOver(this.rules.winnerId);
            return;
        }

        if (result.foul) {
            this.onFoulToast("Foul! Ball in hand.");
            this.awaitingPlacement = true;
            this.cueControls.setEnabled(false);
        } else {
            this.awaitingPlacement = false;
        }

        this._announceTurn();

        if (!result.foul) {
            this.cueControls.setEnabled(this.isLocalTurn());
        }
    }

    // Notifies the hosting screen's HUD of the current turn/scores/suits, and
    // (host-only, multiplayer-only) checks whether the player whose turn it
    // now is has disconnected -- if so, schedules an automatic skip so the
    // game doesn't stall forever waiting for someone who's gone.
    _announceTurn() {
        this.onTurnChange({
            currentPlayerId: this.rules.currentPlayerId,
            scores: Object.fromEntries(this.rules.scores),
            suits: Object.fromEntries(this.rules.suits)
        });

        if (this.mode === "multi" && this.isHost && this.disconnectedPlayers.has(this.rules.currentPlayerId)) {
            setTimeout(() => {
                if (!this.destroyed && this.network && this.network.sendSkipTurn) {
                    this.network.sendSkipTurn(this.rules.currentPlayerId);
                }
            }, 1200);
        }
    }

    // Called by the screen when the server reports a player disconnected mid-game.
    notifyPlayerLeft(playerId) {
        this.disconnectedPlayers.add(playerId);
        if (this.rules.currentPlayerId === playerId) this._announceTurn();
    }

    // Applied identically on every client when the host's skip-turn broadcast arrives.
    handleSkipTurn(playerId) {
        if (this.rules.currentPlayerId !== playerId || this.rules.gameOver) return;
        this.rules.forceAdvanceTurn();
        this._announceTurn();
        this.cueControls.setEnabled(this.isLocalTurn());
    }

    // Runs the AI's shot search (see AIOpponent.js) for the current table
    // state and plays whatever shot it picks. If the AI is the one with
    // ball-in-hand after a foul, it just re-spots the cue ball at the
    // default break position rather than trying to choose an optimal spot
    // (a known simplification, same as the original 2D game's AI).
    async _runAiTurn() {
        if (this.mode !== "single") return;
        this.aiThinking = true;

        if (this.awaitingPlacement) {
            this._placeCueBall(DEFAULT_CUE_BALL_POS.x, DEFAULT_CUE_BALL_POS.z, true);
        }

        const ai = new AIOpponent(this.difficulty);
        const snapshot = [...this.balls.entries()]
            .filter(([, b]) => !b.potted)
            .map(([id, b]) => ({ id, suit: b.suit, x: b.body.position.x, z: b.body.position.z }));

        const shot = await ai.chooseShot(snapshot, this.rules, this.rules.currentPlayerId);
        this.aiThinking = false;
        if (this.destroyed) return;
        this._applyImpulse(shot.angle, shot.power);
    }

    // Tears down the match: stops the animation loop and frees the WebGL
    // renderer. Called when the player backs out of a match screen.
    destroy() {
        this.destroyed = true;
        if (this.raf) cancelAnimationFrame(this.raf);
        this.scene.dispose();
    }
}
