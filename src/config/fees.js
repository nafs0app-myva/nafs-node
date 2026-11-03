// Commercial terms shared by the fee screens, session settlement and bookings.
// The platform fee can be changed per deployment with FEE_PERCENT.
const PLATFORM_FEE_PERCENT = Number(process.env.FEE_PERCENT || 15);
// Client checkout "Service Fee" (Figma Checkout: session 300 + service 15 = 315).
const CLIENT_SERVICE_FEE_PERCENT = Number(process.env.CLIENT_SERVICE_FEE_PERCENT || 5);

module.exports = {
  PLATFORM_FEE_PERCENT,
  CLIENT_SERVICE_FEE_PERCENT,
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
  /** Client-facing service fee on top of the therapist session price. */
  clientServiceFee(sessionFee) {
    return Math.round(Number(sessionFee) * CLIENT_SERVICE_FEE_PERCENT) / 100;
  },
  /** What the client pays at Confirm & Pay. */
  clientTotal(sessionFee) {
    const session = Number(sessionFee) || 0;
    return Math.round((session + this.clientServiceFee(session)) * 100) / 100;
  },
  /** Breakdown shown on the Figma Checkout price summary. */
  checkoutBreakdown(sessionFee, currency = 'SAR') {
    const session_fee = Math.round((Number(sessionFee) || 0) * 100) / 100;
    const service_fee = this.clientServiceFee(session_fee);
    const total = Math.round((session_fee + service_fee) * 100) / 100;
    return {
      currency,
      session_fee,
      service_fee,
      service_fee_percent: CLIENT_SERVICE_FEE_PERCENT,
      total,
    };
  },
};
