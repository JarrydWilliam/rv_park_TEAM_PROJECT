require("dotenv").config();
const app = require("./app");
const { bootstrapDb } = require("./db/bootstrap");

const port = process.env.PORT || 3001;

// Startup: Check MySQL -> ensure DB/user -> then start Express.
(async () => {
  try {
    await bootstrapDb();
    app.listen(port, () => {
      console.log(`Server listening on http://localhost:${port}`);
    });
  } catch (err) {
    console.error(" Failed to start server due to DB/bootstrap error.", err);
    process.exit(1);
  }
})();
