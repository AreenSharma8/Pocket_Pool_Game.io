import { ScreenManager } from "../core/ScreenManager.js";
import { NetworkClient } from "../net/NetworkClient.js";
import { showQuickStartOverlay } from "./instructionsContent.js";

// The actual networked match screen, reached once the host starts the game
// from LobbyScreen. Builds a HUD with one chip per player (2-4 of them),
// then hands off gameplay to a PoolMatch instance in "multi" mode, wiring
// its `network` option to the shared NetworkClient/Socket.io connection.
export const MultiplayerGameScreen = {
    // params.state comes straight from the server's "game-started" payload:
    // { playerIds, playerNames, rackOrder }.
    mount(root, params) {
        this.state = params.state; // { playerIds, playerNames }
        this.playerIds = this.state.playerIds;
        this.playerNames = this.state.playerNames;
        this.localPlayerId = NetworkClient.playerId;

        root.innerHTML = `
            <div class="hud" style="flex-wrap: wrap;">
                <div id="chips-left" style="display:flex; flex-direction:column; gap:6px;"></div>
                <button class="btn secondary" id="btn-quit" style="pointer-events:auto;">Quit</button>
                <div id="chips-right" style="display:flex; flex-direction:column; gap:6px;"></div>
            </div>
            <div class="power-meter"><div class="power-meter-fill"></div></div>
            <button id="hold-to-shoot" class="btn gold-fill hold-to-shoot-btn">Hold to Shoot</button>
            <div class="toast" id="toast"></div>
            <div class="screen hidden" id="result-overlay" style="background: rgba(5,11,24,0.92);">
                <h1 class="logo-title" id="result-title" style="font-size: clamp(32px,6vw,56px);"></h1>
                <div class="menu-stack" style="margin-top: 24px;">
                    <button class="btn gold-fill" id="btn-menu">Main Menu</button>
                </div>
            </div>
        `;

        if ("ontouchstart" in window) {
            root.querySelector("#hold-to-shoot").style.display = "block";
        }

        this._buildChips();

        root.querySelector("#btn-quit").onclick = () => this.exit();
        showQuickStartOverlay(root);

        // Adapter object PoolMatch expects for its `network` option --
        // translates its generic send*/on* calls into the specific
        // NetworkClient/Socket.io methods and events. Keeping this mapping
        // here (rather than in PoolMatch) means PoolMatch itself doesn't
        // need to know anything about Socket.io.
        const network = {
            sendShot: (shot) => NetworkClient.sendShot(shot),
            onShot: (cb) => { this._onShot = cb; NetworkClient.on("shot", cb); },
            sendPlacement: (pos) => NetworkClient.sendCueBallPlacement(pos),
            onPlacement: (cb) => { this._onPlacement = cb; NetworkClient.on("placement", cb); },
            sendSkipTurn: (playerId) => NetworkClient.sendSkipTurn(playerId),
            sendTurnResult: (result) => NetworkClient.sendTurnResult(result),
            onTurnResult: (cb) => { this._onTurnResult = cb; NetworkClient.on("turn-result", cb); }
        };

        // Disconnect handling: show a toast, and let PoolMatch know so it can
        // auto-skip that player's turn if/when it comes up (see
        // notifyPlayerLeft/handleSkipTurn in PoolMatch.js).
        this._onPlayerLeft = ({ playerId }) => {
            this.showToast(`${this.playerNames[playerId] || "A player"} disconnected`);
            if (this.match) this.match.notifyPlayerLeft(playerId);
        };
        this._onSkipTurn = ({ playerId }) => { if (this.match) this.match.handleSkipTurn(playerId); };
        NetworkClient.on("player-left", this._onPlayerLeft);
        NetworkClient.on("skip-turn", this._onSkipTurn);

        import("../game/PoolMatch.js").then(({ PoolMatch }) => {
            const canvas = document.getElementById("game-canvas");
            this.match = new PoolMatch(canvas, {
                mode: "multi",
                playerIds: this.playerIds,
                localPlayerId: this.localPlayerId,
                isHost: NetworkClient.isHost,
                rackOrder: this.state.rackOrder,
                network,
                onTurnChange: (state) => this.updateHud(state),
                onFoulToast: (msg) => this.showToast(msg),
                onGameOver: (winnerId) => this.showResult(winnerId)
            });
            window.__match = this.match;
        });
    },

    // Creates one HUD chip per player up front (alternating left/right side),
    // labeled with their name and "(you)" for the local player.
    _buildChips() {
        const left = this.root().querySelector("#chips-left");
        const right = this.root().querySelector("#chips-right");
        this.playerIds.forEach((id, i) => {
            const target = i % 2 === 0 ? left : right;
            const chip = document.createElement("div");
            chip.className = "player-chip";
            chip.id = `chip-${id}`;
            const label = (this.playerNames[id] || "Player") + (id === this.localPlayerId ? " (you)" : "");
            chip.innerHTML = `${label} <span class="balls" id="balls-${id}"></span>`;
            target.appendChild(chip);
        });
    },

    // Highlights whichever chip belongs to the current player and updates
    // every chip's "suit · score" text -- same shape of state PoolMatch
    // reports to the single-player screen, just applied to N chips instead of 2.
    updateHud(state) {
        this.playerIds.forEach((id) => {
            const chip = this.root().querySelector(`#chip-${id}`);
            if (!chip) return;
            chip.classList.toggle("active", state.currentPlayerId === id);
            const suit = state.suits[id] || "open";
            const score = state.scores[id] || 0;
            this.root().querySelector(`#balls-${id}`).textContent = `${suit} · ${score}`;
        });
    },

    showToast(msg) {
        const toast = this.root().querySelector("#toast");
        toast.textContent = msg;
        toast.classList.add("show");
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => toast.classList.remove("show"), 2200);
    },

    // Shows the win/lose overlay once PoolMatch reports a winner.
    showResult(winnerId) {
        const overlay = this.root().querySelector("#result-overlay");
        const title = this.root().querySelector("#result-title");
        const name = this.playerNames[winnerId] || "Someone";
        title.textContent = winnerId === this.localPlayerId ? "You Win!" : `${name} Wins`;
        overlay.classList.remove("hidden");
        this.root().querySelector("#btn-menu").onclick = () => this.exit();
    },

    root() { return document.getElementById("ui-root"); },

    // Unsubscribes from every socket event this screen registered, leaves the
    // room, and fully disconnects (unlike LobbyScreen's leave(), a match that's
    // ending has no reason to keep the connection open) before returning to the menu.
    exit() {
        NetworkClient.off("player-left", this._onPlayerLeft);
        NetworkClient.off("skip-turn", this._onSkipTurn);
        if (this._onShot) NetworkClient.off("shot", this._onShot);
        if (this._onPlacement) NetworkClient.off("placement", this._onPlacement);
        if (this._onTurnResult) NetworkClient.off("turn-result", this._onTurnResult);
        NetworkClient.leaveRoom();
        NetworkClient.disconnect();
        import("./WelcomeScreen.js").then(({ WelcomeScreen }) => ScreenManager.go("welcome", WelcomeScreen));
    },

    unmount() {
        if (this.match) this.match.destroy();
    }
};
