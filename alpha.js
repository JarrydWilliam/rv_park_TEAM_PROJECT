// alpha.js — launcher for CS3750 Alpha Version
// Uses the same Express app but runs on a different port and banner.

const app = require("./server/src/app");
const port = process.env.ALPHA_PORT || 3050;

app.listen(port, () => {
  console.log(" Running CS3750 Alpha Version on http://localhost:" + port);
});
