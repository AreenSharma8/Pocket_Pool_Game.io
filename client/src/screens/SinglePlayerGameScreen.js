import { ScreenManager } from "../core/ScreenManager.js";
import { showQuickStartOverlay } from "./instructionsContent.js";

// The actual vs-AI match screen: builds the HUD (player/AI score chips,
// power meter, foul toasts, win overlay) around the shared 3D canvas, then
// hands off all the real game logic to a PoolMatch instance in "single" mode.
export const SinglePlayerGameScreen = {
    // Builds the HUD DOM, shows the one-time "how to play" overlay, then
    // lazy-loads PoolMatch and starts the match with a fixed 2-player id
    // list ("human" vs "ai") -- single player never needs real player ids
    // since there's no networking involved.
    mount(root, params) {
        this.difficulty = params.difficulty;

        root.innerHTML = `
            <div class="hud">
                <div class="player-chip" id="chip-human">You <span class="balls" id="chip-human-balls"></span></div>
                <button class="btn secondary" id="btn-quit" style="pointer-events:auto;">Quit</button>
                <div class="player-chip" id="chip-ai">Computer (${params.difficulty.label}) <span class="balls" id="chip-ai-balls"></span></div>
            </div>
            <div class="power-meter"><div class="power-meter-fill"></div></div>
            <button id="hold-to-shoot" class="btn gold-fill hold-to-shoot-btn">Hold to Shoot</button>
            <div class="toast" id="toast"></div>
            <div class="screen hidden" id="result-overlay" style="background: rgba(5,11,24,0.92);">
                <h1 class="logo-title" id="result-title" style="font-size: clamp(32px,6vw,56px);"></h1>
                <div class="menu-stack" style="margin-top: 24px;">
                    <button class="btn gold-fill" id="btn-again">Play Again</button>
                    <button class="btn secondary" id="btn-menu">Main Menu</button>
                </div>
            </div>
        `;

        if ("ontouchstart" in window) {
            root.querySelector("#hold-to-shoot").style.display = "block";
        }

        root.querySelector("#btn-quit").onclick = () => this.exit();
        showQuickStartOverlay(root);

        import("../game/PoolMatch.js").then(({ PoolMatch }) => {
            const canvas = document.getElementById("game-canvas");
            this.match = new PoolMatch(canvas, {
                mode: "single",
                playerIds: ["human", "ai"],
                localPlayerId: "human",
                difficulty: params.difficulty,
                onTurnChange: (state) => this.updateHud(state),
                onFoulToast: (msg) => this.showToast(msg),
                onGameOver: (winnerId) => this.showResult(winnerId)
            });
            window.__match = this.match; // debug hook
        });
    },

    // Highlights whichever chip belongs to the current player, and updates
    // each chip's "suit · score" text from the state PoolMatch reports.
    updateHud(state) {
        const humanChip = this.root().querySelector("#chip-human");
        const aiChip = this.root().querySelector("#chip-ai");
        humanChip.classList.toggle("active", state.currentPlayerId === "human");
        aiChip.classList.toggle("active", state.currentPlayerId === "ai");
        this.root().querySelector("#chip-human-balls").textContent =
            `${state.suits.human || "open"} · ${state.scores.human || 0}`;
        this.root().querySelector("#chip-ai-balls").textContent =
            `${state.suits.ai || "open"} · ${state.scores.ai || 0}`;
    },

    // Briefly flashes a message (e.g. "Foul! Ball in hand.") at the top of the screen.
    showToast(msg) {
        const toast = this.root().querySelector("#toast");
        toast.textContent = msg;
        toast.classList.add("show");
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => toast.classList.remove("show"), 2200);
    },

    // Shows the win/lose overlay once PoolMatch reports the game is over, with
    // buttons to start a fresh match at the same difficulty or return to the menu.
    showResult(winnerId) {
        const overlay = this.root().querySelector("#result-overlay");
        const title = this.root().querySelector("#result-title");
        title.textContent = winnerId === "human" ? "You Win!" : "Computer Wins";
        overlay.classList.remove("hidden");
        this.root().querySelector("#btn-again").onclick = async () => {
            const { SinglePlayerGameScreen } = await import("./SinglePlayerGameScreen.js");
            ScreenManager.go("single-game", SinglePlayerGameScreen, { difficulty: this.difficulty });
        };
        this.root().querySelector("#btn-menu").onclick = () => this.exit();
    },

    root() { return document.getElementById("ui-root"); },

    exit() {
        import("./WelcomeScreen.js").then(({ WelcomeScreen }) => ScreenManager.go("welcome", WelcomeScreen));
    },

    // Stops the match's physics/render loop before this screen is torn down,
    // so it doesn't keep running invisibly in the background.
    unmount() {
        if (this.match) this.match.destroy();
    }
};
