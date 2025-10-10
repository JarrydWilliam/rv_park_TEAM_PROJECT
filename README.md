# Assignment 06 – Team Kickoff (RV Park)

This repository contains:
- `docs/TEAM_CHARTER.md` — satisfies all Charter + Background (a–e) items
- `docs/logo.svg` — placeholder logo
- `docs/TRELLO_CARDS.csv` — import into Trello
- Minimal code fixes for EJS `<title>` and Prisma schema

## Run (WSL, no Docker)
1. Start MySQL (WSL):
   ```bash
   sudo service mysql start

## Quickstart (WSL)
cd server
source ~/.nvm/nvm.sh && nvm install 20 && nvm use 20
sudo service mysql start
sudo mysql -e "CREATE DATABASE IF NOT EXISTS rvpark; CREATE USER IF NOT EXISTS 'team'@'localhost' IDENTIFIED BY 'team123'; GRANT ALL PRIVILEGES ON rvpark.* TO 'team'@'localhost'; FLUSH PRIVILEGES;"
cp .env.example .env
npm install
npx prisma generate
npx prisma migrate dev --name init
npm run seed
npm run dev
# http://localhost:3000  /health  /dbcheck  /vacancy
