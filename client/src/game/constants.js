// All spatial units are meters. Table is modeled roughly on a 7ft bar table
// (2:1 playing-surface ratio) scaled to feel good in a browser viewport.
// x runs along the table's long axis, z along its short axis, y is up.

export const TABLE_LENGTH = 2.0;   // playing surface, x-axis
export const TABLE_WIDTH = 1.0;    // playing surface, z-axis
export const TABLE_SURFACE_Y = 0.8; // height of cloth surface off the ground
export const CUSHION_HEIGHT = 0.045; // how tall the rail cushions stand above the cloth
export const RAIL_THICKNESS = 0.09;  // how deep (in x/z) each cushion segment is

export const BALL_RADIUS = 0.028; // ~56mm diameter, close to a real pool ball
export const CORNER_GAP = 0.11;   // half-width of the notch cut into cushions at each corner pocket
export const SIDE_GAP = 0.10;     // half-width of the notch cut into cushions at each side pocket
// Capture radius must be >= the widest cushion notch, or a ball can clip the edge
// of the gap without ever being detected as "over" the pocket and sail off the table.
export const POCKET_RADIUS = Math.max(CORNER_GAP, SIDE_GAP) + 0.02;
export const POCKET_VISUAL_RADIUS = 0.06; // just the size of the drawn pocket mesh, unrelated to capture logic

export const HALF_L = TABLE_LENGTH / 2;
export const HALF_W = TABLE_WIDTH / 2;

// The six pocket centers, used both for drawing the pocket meshes and for the
// "is a ball close enough to this point to count as sunk" capture check.
export const POCKETS = [
    { name: "cornerA", x: -HALF_L, z: -HALF_W },
    { name: "cornerB", x: HALF_L, z: -HALF_W },
    { name: "cornerC", x: -HALF_L, z: HALF_W },
    { name: "cornerD", x: HALF_L, z: HALF_W },
    { name: "sideL", x: 0, z: -HALF_W },
    { name: "sideR", x: 0, z: HALF_W }
];

// Colors mirror the original game's red/yellow suit split plus cue + 8-ball.
export const SUIT = { RED: "red", YELLOW: "yellow", BLACK: "black", WHITE: "white" };

// Hex colors used for each ball's material in the 3D scene.
export const BALL_COLORS = {
    [SUIT.RED]: 0xc23b3b,
    [SUIT.YELLOW]: 0xe8b923,
    [SUIT.BLACK]: 0x151515,
    [SUIT.WHITE]: 0xf4f0e6
};

// ---- Physics tuning ----
export const GRAVITY = -9.82; // standard Earth gravity, keeps balls pinned to the table
export const BALL_MASS = 0.17; // kg, roughly a real pool ball
export const BALL_LINEAR_DAMPING = 0.35; // simulates rolling friction slowing a ball down over time
export const BALL_ANGULAR_DAMPING = 0.4; // same, but for spin
export const CUE_MAX_IMPULSE = 2.1; // ~12.4 m/s at full power -- fast but survivable on a 2m table without excessive tunneling risk
export const MOVING_THRESHOLD = 0.03; // m/s below which a ball is considered stopped, so a shot is "resolved"

// Where the cue ball starts a fresh rack, and the tip (apex) of the triangle
// of 15 balls -- apex sits closer to the cue ball, matching a real break setup.
export const DEFAULT_CUE_BALL_POS = { x: -TABLE_LENGTH * 0.28, z: 0 };
export const RACK_APEX = { x: TABLE_LENGTH * 0.22, z: 0 };

// Standard "center spot" used to re-spot the black ball -- e.g. when it's
// potted on the break, which doesn't end the game (see Rules.js).
export const BLACK_RESPOT = { x: 0, z: 0 };
