import { SUIT } from "./constants.js";

// 8-ball rules engine, generalized from the original 2-player GamePolicy.js.
//
// 2 players -> classic suits mode: first legally potted object ball assigns
// red/yellow to that player for the rest of the game (matches the original).
// 3-4 players -> rotation mode: no suit ownership (there's no clean 2-way
// split among 3+ people), everyone may shoot any object ball; turns simply
// rotate on a miss/foul and a player who pots legally shoots again. Both
// modes share the same foul/win detection shape.
//
// This class holds no physics or rendering state -- PoolMatch.js feeds it
// events (onShotStart, onFirstContact, onBallPotted) as a shot plays out, then
// calls resolveTurn() once the balls stop moving to find out what happened.
export class Rules {
    // playerIds: ordered list of player identifiers (turn order = array order).
    constructor(playerIds) {
        this.playerIds = playerIds.slice();
        this.mode = playerIds.length === 2 ? "suits" : "rotation";
        this.suits = new Map(playerIds.map((id) => [id, null])); // id -> SUIT.RED | SUIT.YELLOW | null
        this.scores = new Map(playerIds.map((id) => [id, 0]));
        this.turnIndex = 0;
        this.gameOver = false;
        this.winnerId = null;
        this._resetTurnState();
    }

    // Clears everything that only makes sense to track "this turn" (which
    // suit the cue ball hit first, what got potted, etc.), ready for a fresh shot.
    _resetTurnState() {
        this.firstContactSuit = null;
        this.pottedThisTurn = [];
        this.cueBallPotted = false;
        this.blackPotted = false;
    }

    // Convenience getter: whoever's turn it currently is.
    get currentPlayerId() {
        return this.playerIds[this.turnIndex];
    }

    // Call right before applying a shot's impulse, so this turn's tracking starts clean.
    onShotStart() {
        this._resetTurnState();
    }

    // Call when the cue ball's first collision of the turn happens, with the
    // suit of whatever it hit. Only the *first* contact matters for fouls, so
    // later calls this turn are ignored (see the null-check).
    onFirstContact(suit) {
        if (this.firstContactSuit === null) this.firstContactSuit = suit;
    }

    // Call once per ball that fell in a pocket this turn. Cue ball and the
    // black 8-ball are tracked separately since they trigger special rules
    // (scratch, and win/loss) rather than just scoring a point.
    onBallPotted(suit) {
        if (suit === SUIT.WHITE) {
            this.cueBallPotted = true;
        } else if (suit === SUIT.BLACK) {
            this.blackPotted = true;
        } else {
            this.pottedThisTurn.push(suit);
        }
    }

    // How many balls of a given suit are still on the table (not yet potted) --
    // used to check "have I cleared my whole suit yet?" for the 8-ball win condition.
    remainingSuitBallsCount(suit, ballList) {
        return ballList.filter((b) => b.suit === suit && !b.potted).length;
    }

    // The heart of the rules engine. Call once all balls have stopped moving
    // after a shot. ballList: [{id, suit, potted}] describing where every ball
    // ended up. Figures out whether it was a foul, whether the game just
    // ended, updates scores/suit-assignment/turn order, and returns a summary
    // of what happened so PoolMatch can react (show a foul toast, offer ball-
    // in-hand, announce a winner, etc).
    resolveTurn(ballList) {
        const player = this.currentPlayerId;
        const mySuit = this.suits.get(player);
        let foul = false;

        // No first contact at all (totally missed everything) is always a foul.
        if (this.firstContactSuit === null) foul = true;
        // Scratching (potting the cue ball) is always a foul.
        if (this.cueBallPotted) foul = true;

        // Suits mode: hitting the opponent's suit first (once suits are
        // assigned) is a foul, unless it's legal to hit the black (see below).
        if (this.mode === "suits" && mySuit && this.firstContactSuit && this.firstContactSuit !== mySuit && this.firstContactSuit !== SUIT.BLACK) {
            foul = true;
        }
        // You're only allowed to hit the black ball first once your own suit
        // is completely cleared -- hitting it early is a foul.
        if (this.mode === "suits" && mySuit && this.firstContactSuit === SUIT.BLACK) {
            const suitLeft = this.remainingSuitBallsCount(mySuit, ballList);
            if (suitLeft > 0) foul = true;
        }

        let won = false;
        let loserForfeits = false;

        // Potting the black ball always ends the game -- either a win (your
        // suit was already clear and you didn't foul) or an instant loss
        // (potted it early, or committed a foul on the same shot).
        if (this.blackPotted) {
            if (this.mode === "suits") {
                const suitLeft = mySuit ? this.remainingSuitBallsCount(mySuit, ballList) : 1;
                if (!mySuit || suitLeft > 0 || foul) {
                    loserForfeits = true; // potted 8-ball early or on a foul -> loss
                } else {
                    won = true;
                }
            } else {
                const anyLeft = ballList.some((b) => !b.potted && b.suit !== SUIT.BLACK && b.suit !== SUIT.WHITE);
                if (anyLeft || foul) {
                    loserForfeits = true;
                } else {
                    won = true;
                }
            }
            this.gameOver = true;
            this.winnerId = loserForfeits ? this._otherPlayer(player) : player;
        }

        // Suit assignment on first legal pot (2-player classic mode only).
        // Whichever suit you legally pot first becomes "yours" for the rest
        // of the game, and the opponent automatically gets the other suit.
        if (this.mode === "suits" && !mySuit && !foul && this.pottedThisTurn.length > 0) {
            const assigned = this.pottedThisTurn[0];
            this.suits.set(player, assigned);
            const other = this.playerIds.find((id) => id !== player);
            this.suits.set(other, assigned === SUIT.RED ? SUIT.YELLOW : SUIT.RED);
        }

        // Only balls of your own suit count toward your score. In suits mode,
        // potting the opponent's suit doesn't foul you, but it scores *them*,
        // not you (mirrors real 8-ball and the original GamePolicy.js).
        const suitNow = this.suits.get(player);
        const ownPots = this.mode === "suits"
            ? this.pottedThisTurn.filter((s) => s === suitNow).length
            : this.pottedThisTurn.length;
        const oppPots = this.pottedThisTurn.length - ownPots;

        if (!foul) {
            if (ownPots > 0) this.scores.set(player, this.scores.get(player) + ownPots);
            if (this.mode === "suits" && oppPots > 0) {
                const opp = this._otherPlayer(player);
                this.scores.set(opp, this.scores.get(opp) + oppPots);
            }
        }

        // You only keep shooting again if you legally potted at least one of
        // your own balls this turn -- a miss, a foul, or only potting the
        // opponent's ball all pass the turn to the next player.
        const scoredOwnBall = ownPots > 0;
        const keepTurn = !this.gameOver && !foul && scoredOwnBall;

        if (!this.gameOver && !keepTurn) {
            this.turnIndex = (this.turnIndex + 1) % this.playerIds.length;
        }

        return { foul, won: this.gameOver, keepTurn, ballInHand: foul };
    }

    // In 2-player mode this is trivially "the other one". In 3-4 player
    // rotation mode it means "the next player in turn order" -- used both for
    // fouls (loser of an early/foul 8-ball forfeits to this player) and for
    // crediting the opponent's suit score in 2-player mode.
    _otherPlayer(id) {
        if (this.playerIds.length === 2) return this.playerIds.find((p) => p !== id);
        return this.playerIds[(this.playerIds.indexOf(id) + 1) % this.playerIds.length];
    }

    // Used when a player disconnects mid-game: skip past their turn without
    // treating it as a foul (nobody was there to commit one).
    forceAdvanceTurn() {
        this._resetTurnState();
        this.turnIndex = (this.turnIndex + 1) % this.playerIds.length;
    }

    // Human-readable suit for a player, for the HUD -- "open" until they've
    // potted their first ball and suits get assigned (or always "open" in
    // 3-4 player rotation mode, since there's no suit ownership there).
    suitLabel(playerId) {
        const s = this.suits.get(playerId);
        return s ? s : "open";
    }
}
