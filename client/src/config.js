// App-wide configuration constants.

// URL of the multiplayer Socket.io server. When the page itself is running on
// localhost (local dev), we talk to a local server on port 3001. Otherwise
// (the app has been deployed) we talk to the deployed Render server -- update
// the placeholder below with your actual Render URL once you deploy it.
export const SERVER_URL = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:3001"
    : "https://pocket-pool-server.onrender.com";

// Hard cap on how many people can be in one multiplayer lobby/match.
export const MAX_PLAYERS = 4;
