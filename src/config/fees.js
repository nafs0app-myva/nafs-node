// Commercial terms shared by the fee screens, session settlement and bookings.
// The platform fee can be changed per deployment with FEE_PERCENT.
const PLATFORM_FEE_PERCENT = Number(process.env.FEE_PERCENT || 15);

module.exports = {
  PLATFORM_FEE_PERCENT,
  MIN_SESSION_FEE: Number(process.env.MIN_SESSION_FEE || 50),
  MAX_SESSION_FEE: Number(process.env.MAX_SESSION_FEE || 5000),
  PAYOUT_FREQUENCY: 'On request',
  PAYOUT_NOTE: 'Payout requests are reviewed within 3-5 business days.',
  // Cancellation policy: free cancellation up to LATE_CANCEL_HOURS before the
  // session; inside that window the therapist gets COMPENSATION_PERCENT of
  // their share and the client is refunded the rest.
  LATE_CANCEL_HOURS: 24,
  COMPENSATION_PERCENT: 50,
  CANCELLATION_POLICY: {
    title: '24-Hour Notice Policy (Standard)',
    body:
      'Clients receive a 100% refund if cancelled more than 24 hours in advance. ' +
      'You receive 50% compensation for cancellations within 24 hours.',
  },
  /** The therapist's share of a session fee, rounded to 2 decimals. */
  netAmount(fee) {
    return Math.round(Number(fee) * (100 - PLATFORM_FEE_PERCENT)) / 100;
  },
};
