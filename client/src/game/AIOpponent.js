import { PhysicsWorld } from "./PhysicsWorld.js";
import { Rules } from "./Rules.js";
import { SUIT, CUE_MAX_IMPULSE } from "./constants.js";

const MAX_SIM_SECONDS = 3.5; // give up fast-forwarding a candidate shot after this long of simulated time
const SIM_DT = 1 / 60;       // simulated time step per iteration of the fast-forward loop

// A random full-power-ish shot in a random direction, used both as the very
// first candidate and as an occasional "restart from scratch" later on so the
// search doesn't get permanently stuck near a bad local optimum.
function randomAngle() { return Math.random() * Math.PI * 2 - Math.PI; }
function randomPower() { return Math.random() * 0.75 + 0.2; }

// Ports the original hill-climbing shot search (AITrainer/AIPolicy/Opponent)
// onto a headless Cannon-es simulation: try a candidate (angle, power), fast
// -forward physics with no rendering, score the resulting table state, keep
// the best candidate found and mutate around it for the remaining iterations.
//
// In plain terms: the "AI" doesn't understand pool at all -- it just tries a
// bunch of random shots in an invisible copy of the table, sees which one
// leads to the best-looking outcome (balls potted, no foul, spread out),
// nudges its next few guesses toward whatever worked best so far, and then
// actually plays whichever shot scored highest.
export class AIOpponent {
    // difficulty: { iterations, aimError } from SinglePlayerSetupScreen.js --
    // more iterations means a much smarter (but slower-to-decide) opponent;
    // aimError adds random inaccuracy to the final chosen shot so "Easy"
    // still misses sometimes even if it found a good shot in simulation.
    constructor(difficulty) {
        this.iterations = difficulty.iterations;
        this.aimError = difficulty.aimError;
    }

    // Runs the whole search and returns the shot to actually play: { angle, power }.
    // ballsSnapshot: [{id, suit, x, z}] excluding already-potted balls.
    // rules/currentPlayerId used only to evaluate fouls/pots with the same logic as the real game.
    async chooseShot(ballsSnapshot, rules, currentPlayerId) {
        let best = null;
        let bestEval = -Infinity;

        for (let i = 0; i < this.iterations; i++) {
            const candidate = this._buildCandidate(best, bestEval, i);
            const evaluation = this._simulate(candidate, ballsSnapshot, rules, currentPlayerId);

            if (evaluation > bestEval) {
                bestEval = evaluation;
                best = candidate;
            }

            // Yield to the browser every few iterations so this doesn't freeze
            // the tab while "thinking" -- each simulate() call can take a few ms.
            if (i % 4 === 0) await new Promise((r) => setTimeout(r, 0));
        }

        if (!best) best = { angle: randomAngle(), power: randomPower() };

        // Even the best simulated shot gets a bit of real-world sloppiness
        // applied on the actual attempt -- this is what makes lower
        // difficulties visibly miss shots a "perfect" search would nail.
        if (this.aimError > 0) {
            best = { ...best, angle: best.angle + (Math.random() * 2 - 1) * this.aimError };
        }

        return best;
    }

    // Picks the next candidate shot to try. Every 10th attempt (and the very
    // first one) is a completely fresh random guess, to keep exploring rather
    // than fixating on one area. Otherwise, it mutates the best shot found so
    // far: power jitters by a small random amount, and angle jitters by an
    // amount that *shrinks* as the best evaluation score gets better (i.e.
    // once it's found something promising, it searches more precisely around it).
    _buildCandidate(best, bestEval, iteration) {
        if (!best || iteration % 10 === 0) {
            return { angle: randomAngle(), power: randomPower() };
        }
        let power = best.power + (Math.random() * 0.3 - 0.15);
        power = Math.min(1, Math.max(0.2, power));

        let angle = best.angle;
        if (bestEval > 0) {
            angle += (1 / bestEval) * (Math.random() * 2 * Math.PI - Math.PI);
        } else {
            angle = randomAngle();
        }
        return { angle, power };
    }

    // The core of the search: plays out one candidate shot in a brand new,
    // invisible PhysicsWorld (so it never touches the real match's table),
    // fast-forwards it to completion, then scores how good the result was.
    // Returns a single number -- higher is better -- that _buildCandidate/
    // chooseShot use to decide which candidate "wins".
    _simulate(candidate, ballsSnapshot, rules, currentPlayerId) {
        const world = new PhysicsWorld();
        const bodies = new Map();
        const suitById = new Map();
        let cueId = null;

        // Recreate the current table state (just this one ball layout, not
        // the real match) inside the scratch world.
        ballsSnapshot.forEach((b) => {
            const body = world.createBall(b.id, b.x, b.z);
            bodies.set(b.id, body);
            suitById.set(b.id, b.suit);
            if (b.suit === SUIT.WHITE) cueId = b.id;
        });

        const potted = new Set();
        let firstContactSuit = null;

        // Same "what did the cue ball hit first" tracking PoolMatch.js does
        // for real shots, needed so the foul-checking Rules clone below sees
        // an accurate first-contact suit.
        world.world.addEventListener("beginContact", (evt) => {
            if (firstContactSuit !== null) return;
            const idA = this._idForBody(bodies, evt.bodyA);
            const idB = this._idForBody(bodies, evt.bodyB);
            if (!idA || !idB) return;
            if (idA === cueId) firstContactSuit = suitById.get(idB);
            else if (idB === cueId) firstContactSuit = suitById.get(idA);
        });

        // Strike the cue ball with the candidate's angle/power, exactly like
        // a real shot would.
        const cueBody = bodies.get(cueId);
        const dirX = Math.sin(candidate.angle);
        const dirZ = Math.cos(candidate.angle);
        world.applyCueImpulse(cueBody, dirX, dirZ, candidate.power * CUE_MAX_IMPULSE);

        // Fast-forward physics with no rendering until everything stops
        // moving (or we hit the time cap), removing any ball that falls in a
        // pocket along the way -- a simplified version of PoolMatch's real
        // per-frame pocket check, good enough for evaluating a candidate.
        let elapsed = 0;
        while (elapsed < MAX_SIM_SECONDS) {
            world.step(SIM_DT);
            elapsed += SIM_DT;

            for (const [id, body] of bodies) {
                if (potted.has(id)) continue;
                const pocket = world.pocketAt(body.position.x, body.position.z);
                if (pocket) {
                    potted.add(id);
                    world.removeBall(id);
                }
            }

            if (!world.anyMoving()) break;
        }

        const ballList = ballsSnapshot.map((b) => ({
            id: b.id, suit: b.suit, potted: potted.has(b.id) && b.suit !== SUIT.WHITE
        }));

        // Run the resulting state through a disposable copy of the real
        // Rules engine to find out, exactly like a real shot would, whether
        // this candidate was a foul, a win, or scored legally.
        const ruleClone = this._cloneRules(rules, currentPlayerId);
        ruleClone.onShotStart();
        if (firstContactSuit !== null) ruleClone.onFirstContact(firstContactSuit);
        potted.forEach((id) => ruleClone.onBallPotted(suitById.get(id)));
        const outcome = ruleClone.resolveTurn(ballList);

        // Scoring heuristic for "how good was this candidate shot":
        //  - base score rewards a more *spread out* table (sum of pairwise
        //    distances between remaining balls) -- tightly clustered balls
        //    are harder to work with on future turns, so all else being
        //    equal, scattering is good.
        let evaluation = 1;
        const remaining = ballsSnapshot.filter((b) => b.suit !== SUIT.WHITE && !potted.has(b.id));
        for (let i = 0; i < remaining.length; i++) {
            for (let j = i + 1; j < remaining.length; j++) {
                const bi = bodies.get(remaining[i].id);
                const bj = bodies.get(remaining[j].id);
                if (!bi || !bj) continue;
                evaluation += bi.position.distanceTo(bj.position);
            }
        }
        evaluation /= 40;

        // Big bonus per own ball potted (using our own suit's count as a
        // proxy -- black excluded since potting it is handled separately below).
        const ownPots = ballList.filter((b) => b.potted && b.suit !== SUIT.BLACK).length;
        evaluation += ownPots * 40;

        // Winning the game outright is worth far more than anything else --
        // unless it happened on a foul, which is actually a loss, so it's
        // heavily penalized instead. Fouls in general are also penalized so
        // the AI prefers a safe miss over a risky foul when nothing better is available.
        if (outcome.won) evaluation += outcome.foul ? -300 : 400;
        if (outcome.foul) evaluation -= 90;

        return evaluation;
    }

    // Reverse lookup: given a Cannon-es body from a collision event, find
    // which ball id it belongs to (the `bodies` map only goes id -> body).
    _idForBody(bodies, body) {
        for (const [id, b] of bodies) if (b === body) return id;
        return null;
    }

    // Makes a throwaway copy of the real match's Rules state (whose suit is
    // whose, current scores) so a simulated shot can be scored against the
    // *actual* current game situation without ever mutating the real Rules object.
    _cloneRules(rules, currentPlayerId) {
        const clone = new Rules(rules.playerIds);
        clone.turnIndex = rules.playerIds.indexOf(currentPlayerId);
        clone.suits = new Map(rules.suits);
        clone.scores = new Map(rules.scores);
        return clone;
    }
}
