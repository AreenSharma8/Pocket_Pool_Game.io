// Letters/digits used for lobby codes -- 0/O and 1/I are excluded since
// they're easy to mix up when a player is reading a code aloud or typing it
// on a phone keyboard.
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_PLAYERS = 4;

// Rolls a random 4-character code, retrying if it happens to collide with a
// room that already exists (astronomically rare, but cheap to guard against).
function generateCode(existingCodes) {
    let code;
    do {
        code = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");
    } while (existingCodes.has(code));
    return code;
}

// In-memory store of all currently-open lobbies. Nothing here is persisted
// to a database -- rooms live only as long as the server process does (and
// only as long as their host stays connected, see removePlayer below), which
// is the right tradeoff for short-lived casual matches.
export class RoomManager {
    constructor() {
        this.rooms = new Map();      // code -> room
        this.socketToRoom = new Map(); // socketId -> code
    }

    // Creates a new room with the given socket as its host and sole player so far.
    createRoom(socketId, name) {
        const code = generateCode(new Set(this.rooms.keys()));
        const room = {
            code,
            hostId: socketId,
            started: false,
            players: [{ id: socketId, name, isHost: true }]
        };
        this.rooms.set(code, room);
        this.socketToRoom.set(socketId, code);
        return room;
    }

    // Adds a player to an existing room, after checking it actually exists,
    // hasn't already started its match, and isn't already full (throws a
    // human-readable error otherwise, which index.js turns into the
    // acknowledgement the joining client's Promise rejects with).
    joinRoom(code, socketId, name) {
        const room = this.rooms.get(code);
        if (!room) throw new Error("Lobby not found. Check the code.");
        if (room.started) throw new Error("That game has already started.");
        if (room.players.length >= MAX_PLAYERS) throw new Error("Lobby is full (4 players max).");
        room.players.push({ id: socketId, name, isHost: false });
        this.socketToRoom.set(socketId, code);
        return room;
    }

    getRoom(code) {
        return this.rooms.get(code);
    }

    getRoomBySocket(socketId) {
        const code = this.socketToRoom.get(socketId);
        return code ? this.rooms.get(code) : null;
    }

    // Removes a player from whatever room they're in (called on explicit
    // leave or on disconnect). If that empties the room, or the player
    // leaving was the host, the entire room is deleted -- there's no host
    // migration, so a host leaving always ends the lobby for everyone.
    // Returns { room, closed } so the caller (index.js) knows whether to
    // broadcast "room-closed" or just an updated player list.
    removePlayer(socketId) {
        const code = this.socketToRoom.get(socketId);
        if (!code) return null;
        const room = this.rooms.get(code);
        this.socketToRoom.delete(socketId);
        if (!room) return null;

        room.players = room.players.filter((p) => p.id !== socketId);

        if (room.players.length === 0 || socketId === room.hostId) {
            this.rooms.delete(code);
            return { room, closed: true };
        }
        return { room, closed: false };
    }
}
