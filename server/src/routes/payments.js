// server/src/routes/payments.js
const express = require("express");
const router = express.Router();
const pool = require("../db/pool");

const {
    nightsBetween,
    activeRateFor
} = require("../utils/policy");

// ---------------------------------------------------------
// GET /payments/:reservationId
// ---------------------------------------------------------
router.get("/:reservationId", async (req, res) => {
    try {
        const reservationId = req.params.reservationId;

        // Get reservation + site info
        const [rows] = await pool.query(
            `
      SELECT r.*, s.number AS siteNumber, s.type AS siteType
      FROM Reservation r
      JOIN Site s ON r.siteId = s.id
      WHERE r.id = ?
      LIMIT 1
      `,
            [reservationId]
        );

        if (!rows.length) return res.status(404).send("Reservation not found.");

        const r = rows[0];

        // Debug: print reservation and user info
        console.log('DEBUG /payments/:reservationId', { reservation: r, user: req.session && req.session.user });

        // Nights
        const nights = nightsBetween(r.checkIn, r.checkOut);

        // Rate

        // activeRateFor returns an object { nightlyRate }
        const rateResult = await activeRateFor(r.siteType, r.checkIn);
        const nightlyRate = rateResult.nightlyRate;
        const totalAmount = nights * nightlyRate;

        res.render("payments", {
            title: "Complete Your Payment",
            r,
            nights,
            nightlyRate,
            totalAmount,
            reservationId
        });

    } catch (err) {
        console.error("GET /payments/:id error:", err);
        res.status(500).send("Failed to load payment page.");
    }
});

// ---------------------------------------------------------
// POST /payments/process
// ---------------------------------------------------------
router.post("/process", async (req, res) => {
    try {
        const { reservationId, amountPaid, last4, billing } = req.body;

        const txnId = "TXN-" + Math.random().toString(36).substring(2, 10).toUpperCase();

        // Insert Payment record
        await pool.query(
            `
      INSERT INTO Payment (reservationId, userId, amount, paymentMethod, status, transactionId, createdAt)
      VALUES (?, NULL, ?, 'Credit Card', 'Completed', ?, NOW())
      `,
            [reservationId, amountPaid, txnId]
        );

        // Mark reservation as COMPLETED and set paymentMethod
        await pool.query(
            `
      UPDATE Reservation
      SET status = 'COMPLETED', paymentMethod = 'Credit Card', paid = 1
      WHERE id = ?
      `,
            [reservationId]
        );

        // Fetch reservation for confirmation page
        const [rows] = await pool.query(
            `SELECT * FROM Reservation WHERE id = ? LIMIT 1`,
            [reservationId]
        );
        const r = rows[0] || {};
        res.render("confirm", {
            title: "Payment Confirmed",
            message: `Your payment of $${amountPaid} has been processed successfully!`,
            txnId,
            r
        });

    } catch (err) {
        console.error("POST /payments/process error:", err);
        res.status(500).send("Payment processing failed.");
    }
});

module.exports = router;
