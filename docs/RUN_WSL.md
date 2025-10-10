# Runbook – VS Code + WSL (no Docker)

1) Install Node via nvm in WSL and MySQL in WSL.
2) Start MySQL: `sudo service mysql start`
3) Create DB/user (one-time):
   ```sql
   CREATE DATABASE rvpark;
   CREATE USER 'team'@'localhost' IDENTIFIED BY 'team123';
   GRANT ALL PRIVILEGES ON rvpark.* TO 'team'@'localhost';
   FLUSH PRIVILEGES;
   ```
4) In `/server`:
   ```bash
   cp .env.example .env
   # if needed, change host to 127.0.0.1
   npm install
   npx prisma migrate dev --name init
   npm run seed
   npm run dev
   ```
5) Open http://localhost:3000
