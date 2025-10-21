# RV Park Kickoff – Hello World (Express + MySQL)

- Stand-alone Node/Express app that **auto-creates** the MySQL database and `hello_messages` table on startup.
- Reads env from:
  1) `docs/TEAM_KICKOFF/HELLO_WORLD/.env` 
  2) project root `.env` (preferred; contains `DATABASE_URL`)
  3) `server/.env` 