# 🏕️ CS 3750 RV Park Management System – Alpha Version

**Course:** CS 3750 – Software Engineering II  
**Project Stage:** Module 8 – Alpha Version  
**Instructor:** [Insert Instructor Name]  
**Repository:** [https://github.com/JarrydWilliam/rv_park_TEAM_PROJECT](https://github.com/JarrydWilliam/rv_park_TEAM_PROJECT)  
**Branch:** `feature/jarryd-module7`  

---

## 🧑‍💻 Team Members
| Name | Role |
|------|------|
| **Jarryd Burke** | Lead Developer / Full-Stack Integration |
| **Suresh Khaniya** | UI/UX Design & Documentation |
| **Anastasia Salazar** | Database Schema & Data Testing |
| **Jackson Stryker** | Client Communication & QA Testing |

---

## 🎯 Purpose of the Alpha Version

This **Alpha Version** is an early prototype of the RV Park Management System that demonstrates:
1. Major **functional components** of the software  
2. Full **database interaction** (via Prisma ORM)  
3. End-to-end **user flow** through reservations, reports, and payments  
4. Modular **Express architecture** for maintainability  

It satisfies the **Module 8 Alpha Requirements** by implementing:
- **Business logic and database integration**
- **Two+ major functional points**
- **UI connected to backend logic**
- **Complete documentation and design patterns**

---

## Major Functional Points

| Functional Area | Description |
|------------------|-------------|
| **Reservations** | Create, edit, and view reservations (writes to database) |
| **Reports** | Generate daily occupancy/vacancy reports (reads from database) |
| **Payments** | Process or simulate payments and refunds (mock transactions) |

These three modules demonstrate live data interaction, controller logic, and integrated views.

---

## Folder Structure Overview

| Folder/File | Purpose |
|--------------|----------|
| `alpha.js` | Standalone launcher for Alpha (runs server on port 3050) |
| `package.json` | Contains `"alpha"` start script |
| `server/src/app.js` | Express app configuration and route loader |
| `server/src/routes/` | Contains `reservations.js`, `reports.js`, and `payments.js` |
| `server/prisma/schema.prisma` | Validated Prisma database schema |
| `docs/Alpha_Version/` | Documentation for this Alpha version |
| `.env` *(optional)* | Holds environment variables if needed |

---

## Environment Setup

### Prerequisites
- Node.js **v18 or higher** (tested with v22)
- NPM (comes with Node.js)
- Internet connection for initial dependency install

---

## Running the Alpha Version

### Option 1 — Step-by-Step Commands
1. **Open PowerShell (or terminal)**  
   
   RUN:

   cd "C:\Users\Owner\Desktop\School\CS3750\rv_park_consolidated_TEAM_PROJECT"
   if (-not (Test-Path ".\node_modules")) { 
  Write-Host "Installing dependencies..." -ForegroundColor Yellow
  npm install 
}
Write-Host "Launching Alpha server on port 3050..." -ForegroundColor Green
npm run alpha
