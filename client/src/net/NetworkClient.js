import { io } from "socket.io-client";
import { SERVER_URL } from "../config.js";

// Thin wrapper around the Socket.io connection to the lobby/game server.
// One instance is shared for the lifetime of a multiplayer session -- every
// screen/class that needs to talk to the server (LobbyScreen, PoolMatch,
// MultiplayerGameScreen) imports this same object rather than managing its
// own socket.
class NetworkClientImpl {
    constructor() {
        this.socket = null;
        this.roomCode = null; // the 4-letter lobby code we're currently in, if any
        this.playerId = null; // this device's socket id, once connected
        this.isHost = false;  // whether we created the current room (vs joined someone else's)
    }

    // Opens the Socket.io connection if one isn't already open/connected.
    // Resolves once the server confirms the connection, or rejects after an
    // 8s timeout / immediate connection error (e.g. server isn't running).
    connect() {
        if (this.socket && this.socket.connected) return Promise.resolve();

        this.socket = io(SERVER_URL, { transports: ["websocket", "polling"] });

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error("Could not reach the server. Is it running?")), 8000);
            this.socket.once("connect", () => {
                clearTimeout(timeout);
                this.playerId = this.socket.id;
                resolve();
            });
            this.socket.once("connect_error", (err) => {
                clearTimeout(timeout);
                reject(err);
            });
        });
    }

    // Asks the server to create a new lobby with this player as host.
    // Resolves with { code, players } on success.
    createRoom(playerName) {
        return new Promise((resolve, reject) => {
            this.socket.emit("create-room", { name: playerName }, (res) => {
                if (res.error) return reject(new Error(res.error));
                this.roomCode = res.code;
                this.isHost = true;
                resolve(res);
            });
        });
    }

    // Asks the server to join an existing lobby by its 4-letter code.
    // Resolves with { code, players } on success, or rejects with a
    // human-readable reason (full, already started, not found, etc).
    joinRoom(code, playerName) {
        return new Promise((resolve, reject) => {
            this.socket.emit("join-room", { code, name: playerName }, (res) => {
                if (res.error) return reject(new Error(res.error));
                this.roomCode = res.code;
                this.isHost = false;
                resolve(res);
            });
        });
    }

    // Tells the server we're leaving the current room, and clears local room state.
    leaveRoom() {
        if (this.socket) this.socket.emit("leave-room", { code: this.roomCode });
        this.roomCode = null;
        this.isHost = false;
    }

    // Host-only: tells the server to lock in the current player list and
    // begin the match. The server responds by broadcasting "game-started" to everyone.
    startGame() {
        this.socket.emit("start-game", { code: this.roomCode });
    }

    // Host-only: broadcasts the authoritative outcome of a shot (final ball
    // positions, pots, updated scores/turn) to every other client in the room.
    sendTurnResult(result) {
        this.socket.emit("turn-result", { code: this.roomCode, result });
    }

    // Broadcasts "I just took a shot with this angle/power" to the room --
    // every client, including this one, only actually fires the shot once
    // the server echoes this back (see PoolMatch's onShot wiring).
    sendShot(shot) {
        this.socket.emit("shoot", { code: this.roomCode, shot });
    }

    // Broadcasts a ball-in-hand placement to the rest of the room.
    sendCueBallPlacement(position) {
        this.socket.emit("place-cue-ball", { code: this.roomCode, position });
    }

    // Host-only: tells the room to skip a disconnected player's turn.
    sendSkipTurn(playerId) {
        this.socket.emit("skip-turn", { code: this.roomCode, playerId });
    }

    // Passthrough helpers so callers can listen for/stop listening to raw
    // Socket.io events (players-update, game-started, shot, turn-result, etc.)
    // without reaching into `.socket` directly everywhere.
    on(event, cb) {
        this.socket.on(event, cb);
    }

    off(event, cb) {
        if (this.socket) this.socket.off(event, cb);
    }

    // Closes the connection entirely -- called when leaving multiplayer back
    // to the main menu, so a stale connection doesn't linger in the background.
    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
    }
}

// Single shared instance, same pattern as ScreenManager -- every file that
// needs networking imports this exact object.
export const NetworkClient = new NetworkClientImpl();
