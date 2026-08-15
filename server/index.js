import express from "express";
import http from "http";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { Server } from "socket.io";
import { RoomManager } from "./rooms.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The multiplayer server. It is deliberately "dumb" -- it has no idea how
// pool works, doesn't run any physics, and doesn't validate shots. All it
// does is:
//   1. manage lobby rooms (create/join/leave, up to 4 players) via RoomManager
//   2. relay a handful of game events between clients in the same room
// The actual game logic and physics all live client-side (see PoolMatch.js);
// this server is just the "phone line" connecting players in a room, with the
// host's client acting as the source of truth for what actually happened on
// each shot (see the "turn-result" handler below).

const PORT = process.env.PORT || 3001;

const app = express();
app.use(cors());
// Browsers request /favicon.ico automatically for any page, including this
// plain-text one -- answering it with the real logo is what puts it in the
// browser tab, without needing an HTML <link> tag anywhere on this server.
app.get("/favicon.ico", (_req, res) => res.sendFile(path.join(__dirname, "public", "pocket-pool-logo.webp")));
app.get("/", (_req, res) => res.send("Pocket Pool multiplayer server is running."));
app.get("/health", (_req, res) => res.json({ ok: true })); // simple uptime check for Render/monitoring

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const rooms = new RoomManager();

// Generates the one shared shuffle of red/yellow suits for a fresh rack, so
// every client racks the exact same ball layout (see PoolMatch._rack() for
// why that matters). Run once by the server at "start-game" time and sent to
// everyone, rather than each client shuffling independently.
function shuffledSuits() {
    const suits = [...Array(7).fill("red"), ...Array(7).fill("yellow")];
    for (let i = suits.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [suits[i], suits[j]] = [suits[j], suits[i]];
    }
    return suits;
}

// Strips a room's player list down to only what clients need to know (no
// internal server bookkeeping) before sending it over the wire.
function publicPlayers(room) {
    return room.players.map((p) => ({ id: p.id, name: p.name, isHost: p.isHost }));
}

io.on("connection", (socket) => {
    // Creates a brand new lobby with this socket as host. `ack` is the
    // Socket.io acknowledgement callback -- the client's emit() call is
    // waiting for this to resolve its own Promise (see NetworkClient.createRoom).
    socket.on("create-room", ({ name }, ack) => {
        try {
            const room = rooms.createRoom(socket.id, (name || "Player").slice(0, 16));
            socket.join(room.code);
            ack({ code: room.code, players: publicPlayers(room) });
        } catch (err) {
            ack({ error: err.message });
        }
    });

    // Joins an existing lobby by its code. On success, tells everyone
    // already in the room (via a broadcast) that the player list changed,
    // and separately acknowledges the joining client's own request.
    socket.on("join-room", ({ code, name }, ack) => {
        try {
            const room = rooms.joinRoom((code || "").toUpperCase(), socket.id, (name || "Player").slice(0, 16));
            socket.join(room.code);
            io.to(room.code).emit("players-update", publicPlayers(room));
            ack({ code: room.code, players: publicPlayers(room) });
        } catch (err) {
            ack({ error: err.message });
        }
    });

    socket.on("leave-room", () => handleLeave(socket));

    // Host-only: locks in the current player list as the turn order, rolls a
    // fresh shared rack shuffle, and broadcasts "game-started" so every
    // client's LobbyScreen switches over to MultiplayerGameScreen at once.
    socket.on("start-game", ({ code }) => {
        const room = rooms.getRoom(code);
        if (!room || room.hostId !== socket.id || room.players.length < 2) return;
        room.started = true;
        const state = {
            playerIds: room.players.map((p) => p.id),
            playerNames: Object.fromEntries(room.players.map((p) => [p.id, p.name])),
            rackOrder: shuffledSuits()
        };
        io.to(room.code).emit("game-started", state);
    });

    // Relays "someone took a shot with this angle/power" to every client in
    // the room, *including the shooter*, so every client (shooter included)
    // only actually applies the impulse once it comes back through this
    // same event -- keeping everyone's local physics starting from the same trigger.
    socket.on("shoot", ({ code, shot }) => {
        const room = rooms.getRoom(code);
        if (!room) return;
        io.to(room.code).emit("shot", shot);
    });

    // Relays the host's authoritative outcome of a shot (final positions,
    // pots, updated scores/turn) to everyone *except* the host itself, who
    // already knows its own result. Only the host is trusted here -- a
    // non-host client sending this is silently ignored, since only the
    // host's physics simulation is considered ground truth (see PoolMatch's
    // _resolveShotEnd/isHost logic for why independent client simulations can diverge).
    socket.on("turn-result", ({ code, result }) => {
        const room = rooms.getRoom(code);
        if (!room || room.hostId !== socket.id) return; // only the host's resolution is authoritative
        socket.to(room.code).emit("turn-result", result);
    });

    // Relays a ball-in-hand placement to the rest of the room (not back to
    // the sender, who already placed it locally).
    socket.on("place-cue-ball", ({ code, position }) => {
        const room = rooms.getRoom(code);
        if (!room) return;
        socket.to(room.code).emit("placement", position);
    });

    // Relays the host's decision to skip a disconnected player's turn to
    // everyone, so all clients advance their local turn state in lockstep.
    socket.on("skip-turn", ({ code, playerId }) => {
        const room = rooms.getRoom(code);
        if (!room) return;
        io.to(room.code).emit("skip-turn", { playerId });
    });

    // A dropped connection (closed tab, lost network, etc.) is handled
    // exactly like an explicit "leave-room".
    socket.on("disconnect", () => handleLeave(socket));

    // Shared cleanup for both an explicit leave-room and an unexpected
    // disconnect. If the room is now empty, or the person leaving was the
    // host, the whole room is torn down (see RoomManager.removePlayer) and
    // everyone left in it is told the lobby closed. Otherwise just updates
    // the player list -- and if the game had already started, also fires a
    // "player-left" event so a live match knows to route around that player.
    function handleLeave(sock) {
        const result = rooms.removePlayer(sock.id);
        if (!result) return;
        const { room, closed } = result;
        sock.leave(room.code);
        if (closed) {
            io.to(room.code).emit("room-closed");
        } else {
            io.to(room.code).emit("players-update", publicPlayers(room));
            if (room.started) io.to(room.code).emit("player-left", { playerId: sock.id });
        }
    }
});

server.listen(PORT, () => {
    console.log(`Pocket Pool server listening on port ${PORT}`);
});
