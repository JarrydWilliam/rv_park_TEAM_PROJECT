# Alpha Version Demo Write-Up
**Project:** RV Park Reservation System  
**Team Members:**  
- Jarryd Burke  
- Suresh Khaniya  
- Anastasia Salazar  
- Jackson Stryker  

## Overview
This Alpha Version demonstrates two major functional points of the RV Park Reservation System:
1. **Reservation Lifecycle:** Search  Reserve  Confirm  Cancel (with fee policy)
2. **Availability Search:** Check site availability by date, type, and rig length

Both workflows include database read/write via Prisma ORM and use realistic data. The Alpha prototype proves full UIDB interaction and business logic execution.

## Demonstrated Flow
1. **Search for Sites:**  
   - User enters check-in/out dates, rig length, and type.  
   - Application queries the database and returns available sites.

2. **Create Reservation:**  
   - User selects a site and submits reservation info.  
   - System validates availability, rig length, and peak-season rules.  
   - A confirmation code is generated and stored.

3. **Confirm Reservation:**  
   - Confirmation page displays reservation details and amount.

4. **Cancel Reservation:**  
   - User cancels an existing reservation.  
   - The system computes applicable cancellation fees and updates DB.

## Notes
- Database operations handled by Prisma (`reservation`, `site`, `ratePlan` tables).  
- Front-end templates (EJS + Bootstrap) connect seamlessly to backend.  
- Alpha is functional but not yet polished—focus is on business logic.  

