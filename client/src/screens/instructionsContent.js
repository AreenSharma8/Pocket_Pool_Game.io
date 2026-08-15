// Shows a dismissible full-screen "how to play" overlay inside `root` (an already
// -mounted screen). Blocks the game canvas underneath until dismissed.
export function showQuickStartOverlay(root) {
    const overlay = document.createElement("div");
    overlay.className = "screen";
    overlay.style.background = "rgba(5,11,24,0.92)";
    overlay.style.zIndex = "5";
    overlay.innerHTML = `
        <h1 class="logo-title" style="font-size: clamp(28px,5vw,40px);">How to Play</h1>
        <div class="credits-panel" style="max-height: 60vh;">${INSTRUCTIONS_HTML}</div>
        <button class="btn gold-fill" id="btn-lets-play" style="margin-top: 20px;">Let's Play</button>
    `;
    root.appendChild(overlay);
    overlay.querySelector("#btn-lets-play").onclick = () => overlay.remove();
}

export const INSTRUCTIONS_HTML = `
    <h2>Aim</h2>
    <p class="role">Left-click and drag left/right anywhere on the table to rotate your aim around the cue ball. Watch the dotted gold line — it shows exactly where the cue ball will travel.</p>

    <h2>Camera</h2>
    <p class="role">Right-click and drag (or two-finger drag on touch) to orbit your view around the table.</p>

    <h2>Power &amp; Shooting</h2>
    <p class="role">Hold <strong>SPACE</strong> (or press-and-hold the "Hold to Shoot" button on touch devices) to charge your shot. The longer you hold, the harder you hit. Release to strike the cue ball.</p>

    <h2>Ball in Hand</h2>
    <p class="role">After a foul, click anywhere legal on the felt to place the cue ball there before your next shot.</p>

    <h2>Goal</h2>
    <p class="role">The first ball you legally pot assigns you red or yellow for the rest of the game. Pot all of your suit, then legally pot the black 8-ball to win. Potting the cue ball, hitting the wrong suit first, or sinking the 8-ball early is a foul.</p>
`;
