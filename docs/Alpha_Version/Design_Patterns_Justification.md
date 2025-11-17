# Design Patterns Justification
**Project:** RV Park Reservation System – Alpha Version  

## MVC (Model-View-Controller)
- **Model:** Prisma ORM models and `policy.js`
- **View:** EJS templates (`search.ejs`, `confirm.ejs`, etc.)
- **Controller:** Express routes (`search.js`, `reservations.js`, `system.js`)
- Ensures a clear separation between business logic, UI, and database access.

## Singleton
- Implemented in `prisma.js` to maintain a single Prisma Client instance.
- Reduces DB connection overhead and ensures consistent state.

## Repository Pattern (via Prisma)
- Prisma serves as a repository abstraction, handling CRUD operations cleanly.

## Policy Utility Module
- `policy.js` encapsulates reusable logic for date calculations, rates, and fee policy.

## Summary
The use of these patterns improves scalability, maintainability, and readability.
