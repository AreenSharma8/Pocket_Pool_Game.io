import { ScreenManager } from "../core/ScreenManager.js";

// The very first screen the app shows (see main.js). Just a menu: Single
// Player, Multiplayer, How to Play, Credits -- each button lazy-loads the
// screen it leads to and hands off to ScreenManager.
export const WelcomeScreen = {
    // Builds the menu HTML and wires each button to navigate to its destination screen.
    mount(root) {
        root.innerHTML = `
            <div class="screen" id="welcome-screen">
                <div id="logo-slot">
                    <h1 class="logo-title">POCKET<small>POOL</small></h1>
                </div>
                <p class="tagline">Big Fun. Small Table. Endless Game.</p>
                <div class="menu-stack">
                    <button class="btn gold-fill" id="btn-single">Single Player</button>
                    <button class="btn" id="btn-multi">Multiplayer</button>
                    <button class="btn secondary" id="btn-howto">How to Play</button>
                    <button class="btn secondary" id="btn-credits">Credits</button>
                </div>
            </div>
        `;

        root.querySelector("#btn-single").onclick = async () => {
            const { SinglePlayerSetupScreen } = await import("./SinglePlayerSetupScreen.js");
            ScreenManager.go("single-setup", SinglePlayerSetupScreen);
        };
        root.querySelector("#btn-multi").onclick = async () => {
            const { LobbyScreen } = await import("./LobbyScreen.js");
            ScreenManager.go("lobby", LobbyScreen);
        };
        root.querySelector("#btn-howto").onclick = async () => {
            const { InstructionsScreen } = await import("./InstructionsScreen.js");
            ScreenManager.go("instructions", InstructionsScreen);
        };
        root.querySelector("#btn-credits").onclick = async () => {
            const { CreditsScreen } = await import("./CreditsScreen.js");
            ScreenManager.go("credits", CreditsScreen);
        };
    },
    unmount() {}
};
