import { ScreenManager } from "../core/ScreenManager.js";
import { NetworkClient } from "../net/NetworkClient.js";
import { MAX_PLAYERS } from "../config.js";

// Fallback display name if the player leaves the name field blank.
function randomName() {
    const n = Math.floor(Math.random() * 999);
    return "Player" + n;
}

// The multiplayer pre-game screen: create a new lobby or join one by code,
// then wait in a lobby/player-list view until the host starts the match. All
// the actual networking goes through the shared NetworkClient singleton.
export const LobbyScreen = {
    // Builds the "create or join" form plus a (hidden until needed) waiting
    // room view, and wires up all the button handlers and NetworkClient event
    // listeners this screen cares about.
    mount(root) {
        this.root = root;
        root.innerHTML = `
            <div class="screen">
                <button class="btn secondary back-btn" id="btn-back">&larr; Back</button>
                <h1 class="logo-title" style="font-size: clamp(28px,5vw,44px);">Multiplayer</h1>
                <p class="tagline">Up to ${MAX_PLAYERS} players &middot; play with a lobby code</p>
                <div class="lobby-form" id="entry-form">
                    <input class="lobby-code-input" id="name-input" placeholder="Your name" maxlength="16" style="text-transform:none; letter-spacing: normal; font-size: 18px;">
                    <button class="btn gold-fill" id="btn-create">Create Lobby</button>
                    <div style="display:flex; gap:8px;">
                        <input class="lobby-code-input" id="code-input" placeholder="CODE" maxlength="4" style="flex:1; padding:10px;">
                        <button class="btn" id="btn-join" style="flex:1;">Join</button>
                    </div>
                </div>
                <p class="error-text" id="error-text"></p>
                <div id="waiting-room" class="hidden">
                    <div class="lobby-code-display" id="code-display"></div>
                    <ul class="player-list" id="player-list"></ul>
                    <button class="btn gold-fill hidden" id="btn-start">Start Game</button>
                    <p class="status-text" id="wait-status">Waiting for host to start&hellip;</p>
                </div>
            </div>
        `;

        root.querySelector("#btn-back").onclick = () => this.leave(true);

        root.querySelector("#btn-create").onclick = () => this.handleCreate();
        root.querySelector("#btn-join").onclick = () => this.handleJoin();

        this.errorEl = root.querySelector("#error-text");
        this.playerListEl = root.querySelector("#player-list");
        this.codeDisplayEl = root.querySelector("#code-display");
        this.startBtn = root.querySelector("#btn-start");
        this.waitStatusEl = root.querySelector("#wait-status");

        this.startBtn.onclick = () => NetworkClient.startGame();

        // Bound as instance properties (not inline arrow functions passed
        // directly to .on()) so leave()/unmount() can pass the exact same
        // function reference to .off() and actually remove the listener.
        this.onPlayersUpdate = (players) => this.renderPlayers(players);
        this.onGameStarted = (state) => this.handleGameStart(state);
        this.onRoomClosed = () => {
            this.setError("Host left. Lobby closed.");
            root.querySelector("#waiting-room").classList.add("hidden");
            root.querySelector("#entry-form").classList.remove("hidden");
        };
    },

    setError(msg) {
        this.errorEl.textContent = msg || "";
    },

    // Opens the socket connection if it isn't already open, showing a
    // "Connecting..." message while it does.
    async ensureConnected() {
        this.setError("Connecting to server...");
        await NetworkClient.connect();
        this.setError("");
    },

    // "Create Lobby" button handler: connects, asks the server for a new
    // room, and switches this screen into the waiting-room view as host.
    async handleCreate() {
        const name = this.root.querySelector("#name-input").value.trim() || randomName();
        try {
            await this.ensureConnected();
            const res = await NetworkClient.createRoom(name);
            this.enterWaitingRoom(res, true);
        } catch (err) {
            this.setError(err.message);
        }
    },

    // "Join" button handler: same as handleCreate but joins an existing
    // room by the code typed into the input.
    async handleJoin() {
        const name = this.root.querySelector("#name-input").value.trim() || randomName();
        const code = this.root.querySelector("#code-input").value.trim().toUpperCase();
        if (!code) { this.setError("Enter a lobby code."); return; }
        try {
            await this.ensureConnected();
            const res = await NetworkClient.joinRoom(code, name);
            this.enterWaitingRoom(res, false);
        } catch (err) {
            this.setError(err.message);
        }
    },

    // Switches from the create/join form to the waiting-room view: shows the
    // lobby code, the current player list, a Start Game button (host only),
    // and starts listening for live updates from the server.
    enterWaitingRoom(res, isHost) {
        this.setError("");
        this.root.querySelector("#entry-form").classList.add("hidden");
        this.root.querySelector("#waiting-room").classList.remove("hidden");
        this.codeDisplayEl.textContent = res.code;
        this.renderPlayers(res.players);
        this.startBtn.classList.toggle("hidden", !isHost);
        this.waitStatusEl.textContent = isHost
            ? "Share this code with up to 3 friends, then start when ready."
            : "Waiting for host to start the game...";

        NetworkClient.on("players-update", this.onPlayersUpdate);
        NetworkClient.on("game-started", this.onGameStarted);
        NetworkClient.on("room-closed", this.onRoomClosed);
    },

    // Re-renders the player list every time the server reports someone
    // joined/left, and (host only) keeps the Start Game button's enabled
    // state and label in sync with how many players are currently in the room.
    renderPlayers(players) {
        this.playerListEl.innerHTML = players.map(p => `
            <li class="${p.id === NetworkClient.playerId ? "me" : ""}">
                <span>${p.name}${p.isHost ? " (Host)" : ""}</span>
                <span class="tag">${p.id === NetworkClient.playerId ? "you" : "connected"}</span>
            </li>
        `).join("");
        if (this.startBtn && NetworkClient.isHost) {
            this.startBtn.disabled = players.length < 2;
            this.startBtn.textContent = players.length < 2
                ? `Add up to ${MAX_PLAYERS} players (${players.length})`
                : "Start Game";
        }
    },

    // Fired for every client once the host presses Start Game and the server
    // broadcasts "game-started" with the locked-in player order and rack layout.
    async handleGameStart(state) {
        // Mark the room transition as intentional so unmount() below doesn't
        // also tell the server we're leaving the room we just started a game in.
        this.startingGame = true;
        const { MultiplayerGameScreen } = await import("./MultiplayerGameScreen.js");
        ScreenManager.go("multi-game", MultiplayerGameScreen, { state });
    },

    // Cleans up this screen's socket listeners and, unless we're leaving
    // *because* the match is starting, tells the server we're leaving the room.
    leave(goBack) {
        NetworkClient.off("players-update", this.onPlayersUpdate);
        NetworkClient.off("game-started", this.onGameStarted);
        NetworkClient.off("room-closed", this.onRoomClosed);
        if (!this.startingGame && NetworkClient.roomCode) NetworkClient.leaveRoom();
        if (goBack) {
            import("./WelcomeScreen.js").then(({ WelcomeScreen }) => ScreenManager.go("welcome", WelcomeScreen));
        }
    },

    unmount() {
        this.leave(false);
    }
};
