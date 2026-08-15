// App entry point, loaded by index.html as a module script.
// All it does is register the very first screen (the main menu) with the
// ScreenManager -- every other screen (single player, lobby, credits, the
// in-game HUD, etc.) is reached by navigating away from here via
// ScreenManager.go(), each screen importing the next one as it's needed.
import { ScreenManager } from "./core/ScreenManager.js";
import { WelcomeScreen } from "./screens/WelcomeScreen.js";

ScreenManager.go("welcome", WelcomeScreen);

// Best-effort landscape lock: the Screen Orientation Lock API only actually
// works on a handful of browser/fullscreen combinations (mainly Android
// Chrome, and generally only once the page is fullscreen) and isn't
// supported at all on iOS Safari -- so this is a bonus for the browsers
// where it works, not something to rely on. The CSS "rotate your device"
// overlay (see style.css) is what actually guarantees landscape everywhere.
if (screen.orientation && screen.orientation.lock) {
    document.addEventListener("click", function tryLockOrientation() {
        screen.orientation.lock("landscape").catch(() => {});
    }, { once: true });
}
