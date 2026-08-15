import { ScreenManager } from "../core/ScreenManager.js";

// Each difficulty maps to AIOpponent's search parameters: `iterations` is how
// many candidate shots it tries before committing (more = smarter but
// slower to "think"), `aimError` is random inaccuracy applied to its final
// choice (0 = perfect aim once it's found a good shot).
const DIFFICULTIES = [
    { key: "easy", label: "Easy", iterations: 12, aimError: 0.22 },
    { key: "medium", label: "Medium", iterations: 22, aimError: 0.12 },
    { key: "hard", label: "Hard", iterations: 36, aimError: 0.05 },
    { key: "insane", label: "Insane", iterations: 55, aimError: 0.0 }
];

// Difficulty-picker screen between the welcome screen and an actual single
// -player match. Whichever difficulty is chosen gets passed straight through
// to SinglePlayerGameScreen -> PoolMatch -> AIOpponent.
export const SinglePlayerSetupScreen = {
    mount(root) {
        root.innerHTML = `
            <div class="screen">
                <button class="btn secondary back-btn" id="btn-back">&larr; Back</button>
                <h1 class="logo-title" style="font-size: clamp(28px,5vw,44px);">Choose Difficulty</h1>
                <div class="menu-stack" style="margin-top: 32px;">
                    ${DIFFICULTIES.map(d => `<button class="btn" data-diff="${d.key}">${d.label}</button>`).join("")}
                </div>
            </div>
        `;

        root.querySelector("#btn-back").onclick = async () => {
            const { WelcomeScreen } = await import("./WelcomeScreen.js");
            ScreenManager.go("welcome", WelcomeScreen);
        };

        root.querySelectorAll("[data-diff]").forEach(btn => {
            btn.onclick = async () => {
                const diff = DIFFICULTIES.find(d => d.key === btn.dataset.diff);
                const { SinglePlayerGameScreen } = await import("./SinglePlayerGameScreen.js");
                ScreenManager.go("single-game", SinglePlayerGameScreen, { difficulty: diff });
            };
        });
    },
    unmount() {}
};
