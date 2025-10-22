# Background & Proposed Solution – RV Park

## (a) Problem Statement (2–4 sentences)
Small RV parks often run reservations by phone and spreadsheets, which causes overbooking, unclear availability, and manual pricing during special events. The client needs a lightweight system to search by rig length and site type, see availability instantly, and handle policy differences (e.g., one-night cancel fee during events). The solution should be simple to run and easy for staff to adopt.

## (b) Domain & Target Users
- **Domain:** Campground/RV park reservations
- **Users:** Front-desk staff, park managers, and guests (public search later)

## (c) Similar Systems
- **Campspot, KOA, ReserveAmerica.**
- Pros: robust features, guest portals, payments.  
- Cons: costly, vendor lock-in, complex setup; hard to customize for small parks.

## (d) Limitations in Others & Our Response
- **Cost/complexity:** We ship a minimal, self-hostable Node/Express app.
- **Custom policies:** Model special events & rate plans as first-class DB objects.
- **Clarity of availability:** Rig-length + type aware search with conflict checks.
- **Data ownership:** MySQL with Prisma; park owns its data.

## (e) Proposed Solution (2–4 sentences)
Build a Node/Express + EJS app backed by MySQL via Prisma. Staff can search availability by dates, rig length, and site type; events and rate plans adjust rules/pricing. MVP focuses on internal staff use; a guest-facing flow can follow. The stack is lightweight, runs in VS Code + WSL, and all teammates can set up in minutes.

## Software Stack (agreed)
- Node.js 20 (nvm), Express, EJS, Bootstrap 5 (premium dark theme)
- Prisma ORM 5.x, MySQL 8
- Dev: VS Code + WSL, nodemon

## Repo & Trello
- **Repo:** (private) `https://github.com/…` (share with instructor)
- **Trello:** link here → _________
