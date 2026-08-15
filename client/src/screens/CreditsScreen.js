import { ScreenManager } from "../core/ScreenManager.js";

// Static credits page, reached from the welcome screen. No game logic here --
// just markup and a back button.
export const CreditsScreen = {
    mount(root) {
        root.innerHTML = `
            <div class="screen">
                <button class="btn secondary back-btn" id="btn-back">&larr; Back</button>
                <div class="credits-panel">
                    <h2>Development</h2>
                    <p class="name">Areen Sharma</p>
                    <p class="role">Game Developer</p>

                    <h2>Game Design</h2>
                    <p class="name">Areen Sharma</p>
                    <p class="role">Game Concept &amp; Gameplay Design</p>

                    <h2>UI / UX Design</h2>
                    <p class="name">Areen Sharma</p>
                    <p class="role">Interface &amp; User Experience</p>

                    <h2>Audio &amp; Sound</h2>
                    <p class="name">Areen Sharma</p>
                    <p class="role">Audio Integration &amp; Sound Design</p>

                    <p class="thanks">Thank you for playing Pocket Pool.<br>Your support makes this game possible.</p>

                    <div class="footer">
                        <strong>POCKET POOL</strong><br>
                        <em>Big Fun. Small Table. Endless Game.</em><br><br>
                        Developed by Areen Sharma<br>
                        August 2026<br><br>
                        &copy; 2026 Areen Sharma. All Rights Reserved.
                    </div>
                </div>
            </div>
        `;

        root.querySelector("#btn-back").onclick = async () => {
            const { WelcomeScreen } = await import("./WelcomeScreen.js");
            ScreenManager.go("welcome", WelcomeScreen);
        };
    },
    unmount() {}
};
