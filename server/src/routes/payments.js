const express = require('express');
const router = express.Router();

// GET /payments - simple Alpha demo page
router.get('/', (req, res) => {
  res.send(`
    <h1>Alpha Payments Demo</h1>
    <p>This page demonstrates the Payments functional point for the Alpha version.</p>
    <form method="post" action="/payments/process">
      <div>
        <label>
          Reservation ID:
          <input name="reservationId" required />
        </label>
      </div>
      <div>
        <label>
          Amount:
          <input name="amount" type="number" step="0.01" required />
        </label>
      </div>
      <button type="submit">Process Payment</button>
    </form>
    <p><a href="/">Return to Home</a></p>
  `);
});

// POST /payments/process - mock payment for Alpha demo
router.post('/process', async (req, res) => {
  try {
    const { reservationId, amount } = req.body;

    console.log(`Processing payment for reservation ${reservationId} ($${amount}) [ALPHA MOCK]`);

    // For Alpha: no real DB/gateway write. Just show confirmation.
    // Uses existing confirm.ejs view shared with the main project.
    res.render('confirm', {
      title: 'Payment Confirmation',
      message: 'Payment processed successfully! (Alpha mock)',
    });
  } catch (err) {
    console.error('Error in /payments/process:', err);
    res.status(500).send('Error processing payment');
  }
});

module.exports = router;
