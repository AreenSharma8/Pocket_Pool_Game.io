import { ScreenManager } from "../core/ScreenManager.js";
import { INSTRUCTIONS_HTML } from "./instructionsContent.js";

// Full-screen "How to Play" page, reached from the welcome screen's own
// button. Reuses the same INSTRUCTIONS_HTML markup that also appears as a
// dismissible overlay at the start of an actual match (see instructionsContent.js).
export const InstructionsScreen = {
    mount(root) {
        root.innerHTML = `
            <div class="screen">
                <button class="btn secondary back-btn" id="btn-back">&larr; Back</button>
                <h1 class="logo-title" style="font-size: clamp(28px,5vw,44px);">How to Play</h1>
                <div class="credits-panel">${INSTRUCTIONS_HTML}</div>
            </div>
        `;

        root.querySelector("#btn-back").onclick = async () => {
            const { WelcomeScreen } = await import("./WelcomeScreen.js");
            ScreenManager.go("welcome", WelcomeScreen);
        };
    },
    unmount() {}
};
