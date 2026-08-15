// Minimal screen/state router. The whole app is a single HTML page (index.html)
// with one <div id="ui-root"> that different "screens" take turns owning --
// there's no page navigation or framework, just plain DOM swapping.
//
// Each screen is a plain object with:
//   mount(root, params) -> called when the screen becomes active. Build whatever
//                           DOM/3D content it needs inside `root`, and wire up
//                           its own event listeners here.
//   unmount()            -> called right before the screen is torn down. Must
//                           clean up anything it started (animation loops,
//                           socket listeners, timers) so it doesn't keep running
//                           in the background after the user has navigated away.
class ScreenManagerImpl {
    constructor() {
        this.root = document.getElementById("ui-root");
        this.current = null;
        this.currentName = null;
    }

    // Switches the active screen: unmounts whatever was showing, clears the
    // DOM, then mounts the new screen with whatever params it needs (e.g. the
    // chosen AI difficulty, or the multiplayer room state after a game starts).
    go(name, screen, params) {
        if (this.current && this.current.unmount) {
            this.current.unmount();
        }
        this.root.innerHTML = "";
        this.current = screen;
        this.currentName = name;
        screen.mount(this.root, params || {});
    }
}

// Single shared instance -- every screen imports this same object so they can
// all navigate to each other without passing a reference around manually.
export const ScreenManager = new ScreenManagerImpl();
