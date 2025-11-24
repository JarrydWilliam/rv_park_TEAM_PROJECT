# Assignment 06 – Team Kickoff (RV Park)

Consolidated team repository for the RV Park reservation system prototype.

This repo contains:

- `docs/TEAM_CHARTER.md` — satisfies all Charter + Background (a–e) items  
- `docs/logo.svg` — placeholder logo  
- `docs/TRELLO_CARDS.csv` — import into Trello  
- `docs/BACKGROUND.md` and `docs/REQUIREMENTS_DESIGN/` — written requirements and design docs  
- `docs/Alpha_Version/` — Alpha demo writeups (still reference Prisma conceptually)  
- `server/` — Node.js + Express app wired to a MySQL `rvpark` database via `mysql2`  
- `.gitignore` / `.env.example` — standard Node + MySQL ignores and config template  

---

## Tech Stack

- Backend: Node.js, Express  
- Views: EJS + Bootstrap (dark theme)  
- Database: MySQL (`rvpark` schema)  
- DB Access: `mysql2` (no Prisma in the running app)  
- Dev tooling: nodemon, jest, supertest  

---

## Database Implementation (Consolidated Version)

For this consolidated version of the project, the *running server does not use Prisma*.

Instead:

- The backend uses the [`mysql2`](https://www.npmjs.com/package/mysql2) library to connect directly to a MySQL database named `rvpark`.
- Connection details come from `server/.env` (see `server/.env.example` for the exact variable names).
- Default local setup (what the code expects out of the box):

  - Host: `127.0.0.1`  
  - Port: `3307`  
  - Database: `rvpark`  
  - User: `team`  
  - Password: `team123`

- On startup (`npm start` or `npm run dev` inside `server/`), you’ll see logs similar to:

  ```text
  === RV Park DB Bootstrap (OLD project) ===
  DB host: 127.0.0.1:3307, DB name: rvpark, app user: team
  ✅ MySQL is reachable and RV Park DB already exists.
     Connected as app user, skipping DB/user creation.
  Server listening on http://localhost:3001





## ******DETAILED README*****
Repository Layout

High-level structure:

.
├── docs/
│   ├── TEAM_CHARTER.md
│   ├── BACKGROUND.md
│   ├── REQUIREMENTS_DESIGN/
│   └── Alpha_Version/
│       ├── Alpha_Demo_Writeup.md
│       ├── Alpha_Presentation_Outline.md
│       ├── DESIGN_PATTERNS.md
│       └── ...
├── server/
│   ├── src/
│   │   ├── index.js        # Entry point (Express app + DB bootstrap)
│   │   ├── app.js          # Express app setup, routes, views, etc.
│   │   ├── routes/         # reservations, payments, reports, etc.
│   │   └── utils/          # policy helpers, etc.
│   ├── public/             # CSS, JS, static assets (dark theme)
│   ├── views/              # EJS templates
│   ├── .env.example        # Sample env configuration
│   ├── package.json
│   └── ...
├── .gitignore
└── README.md               # (this file)

Prerequisites

For the recommended setup (WSL + MySQL + Node):

WSL (Ubuntu or similar)

MySQL server installed in WSL

Node.js 20.x (via nvm recommended)

Git

Setup & Run (WSL, No Docker)
1. Start MySQL in WSL
sudo service mysql start

2. Create the rvpark Database and team User (once)

Run this in WSL:

sudo mysql -e "CREATE DATABASE IF NOT EXISTS rvpark;
CREATE USER IF NOT EXISTS 'team'@'localhost' IDENTIFIED BY 'team123';
GRANT ALL PRIVILEGES ON rvpark.* TO 'team'@'localhost';
FLUSH PRIVILEGES;"


If your MySQL is bound on a different port or host, adjust your .env accordingly.

3. Configure the Server Environment

From the repo root:

cd server
cp .env.example .env


Then open .env and verify/update values (example):

DB_HOST=127.0.0.1
DB_PORT=3307
DB_NAME=rvpark
DB_USER=team
DB_PASSWORD=team123

# Server port
PORT=3001


The DB_PORT is set to 3307 in this consolidated version to match the dev environment logs you’ll see.
If your MySQL runs on the default 3306, set DB_PORT=3306 instead.

4. Install Node Dependencies

From the server/ directory:

cd server
# (Optional but recommended) in WSL, use Node 20 via nvm:
source ~/.nvm/nvm.sh && nvm install 20 && nvm use 20

npm install


There are no Prisma commands in this version (no npx prisma generate, no npx prisma migrate).

5. Run the Server

Development (auto-restart via nodemon):

npm run dev


or plain start:

npm start


You should see output similar to:

=== RV Park DB Bootstrap (OLD project) ===
DB host: 127.0.0.1:3307, DB name: rvpark, app user: team
✅ MySQL is reachable and RV Park DB already exists.
   Connected as app user, skipping DB/user creation.
Server listening on http://localhost:3001


Then open in your browser:

http://localhost:3001

Health/diagnostic endpoints:

/health

/dbcheck

/vacancy