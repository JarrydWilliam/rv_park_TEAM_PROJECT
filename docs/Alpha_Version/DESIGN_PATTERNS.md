#  Design Patterns & Architecture

## Application Structure
- **MVC Pattern:**  
  - *Model:* Prisma ORM models and schema for Reservations, Sites, and Customers  
  - *View:* EJS templates for forms and reports  
  - *Controller:* Express route handlers for reservations, payments, and reports  

## Design Justification
This separation of concerns simplifies debugging and scalability:
- Controllers handle routing and logic  
- Models manage persistent data  
- Views provide user interaction  

## Additional Patterns
- **Singleton:** Prisma client instance reused across modules  
- **Module Pattern:** Each route file encapsulates functionality to reduce coupling.
