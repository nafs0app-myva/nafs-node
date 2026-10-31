const { query } = require('../config/db');
const { wallClock } = require('../utils/time');

const STEP = 30 * 60; // bookable start times every 30 minutes
const DEFAULT_SESSION_MINUTES = 50;

const toSeconds = (t) => {
  const [h = 0, m = 0, s = 0] = String(t).split(':').map((n) => parseInt(n, 10) || 0);
  return h * 3600 + m * 60 + s;
};
const toTime = (sec) =>
  `${String(Math.floor(sec / 3600)).padStart(2, '0')}:${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;

/**
 * Open start times (`HH:mm:ss`, therapist-local) for each day in `dayList`
 * (`[{ iso: 'YYYY-MM-DD', weekday }]`). A time is open when it is inside an
 * active weekly slot, not on time off, not in the past, and does not overlap an
 * existing booking or scheduled session.
 */
async function bookableTimes(therapistId, dayList) {
  const [tp] = await query(`SELECT timezone, session_duration_minutes FROM therapist_profiles WHERE user_id = :id`, { id: therapistId });
  const tz = tp?.timezone || 'Asia/Riyadh';
  const SESSION_SECONDS = (Number(tp?.session_duration_minutes) || DEFAULT_SESSION_MINUTES) * 60;
  const first = dayList[0].iso;
  const last = dayList[dayList.length - 1].iso;

  const slots = await query(
    `SELECT weekday, start_time, end_time FROM availability_slots WHERE therapist_id = :tid AND is_active = 1`,
    { tid: therapistId }
  );
  const vacations = await query(
    `SELECT DATE_FORMAT(start_date, '%Y-%m-%d') AS s, DATE_FORMAT(end_date, '%Y-%m-%d') AS e,
            TIME_FORMAT(start_time, '%H:%i:%s') AS st, TIME_FORMAT(end_time, '%H:%i:%s') AS et
     FROM vacation_blocks WHERE therapist_id = :tid AND start_date <= :last AND end_date >= :first`,
    { tid: therapistId, first, last }
  );
  const bookings = await query(
    `SELECT DATE_FORMAT(booking_date, '%Y-%m-%d') AS d, TIME_FORMAT(booking_time, '%H:%i:%s') AS t
     FROM bookings WHERE therapist_id = :tid AND status IN ('confirmed','pending_payment')
       AND booking_date BETWEEN :first AND :last`,
    { tid: therapistId, first, last }
  );
  // Sessions are stored in UTC; convert to the therapist's wall clock.
  const sessions = await query(
    `SELECT starts_at, ends_at FROM sessions
     WHERE therapist_id = :tid AND status IN ('scheduled','in_progress')
       AND starts_at >= DATE_SUB(:first, INTERVAL 1 DAY) AND starts_at <= DATE_ADD(:last, INTERVAL 2 DAY)`,
    { tid: therapistId, first, last }
  );

  // Busy intervals per local date: [startSec, endSec).
  const busy = new Map();
  const addBusy = (date, from, to) => busy.set(date, [...(busy.get(date) || []), [from, to]]);
  for (const b of bookings) addBusy(b.d, toSeconds(b.t), toSeconds(b.t) + SESSION_SECONDS);
  for (const s of sessions) {
    const [d, t] = wallClock(new Date(s.starts_at), tz).split(' ');
    const from = toSeconds(t);
    addBusy(d, from, from + Math.max(SESSION_SECONDS, Math.round((new Date(s.ends_at) - new Date(s.starts_at)) / 1000)));
  }
  const [today, nowTime] = wallClock(new Date(), tz).split(' ');
  const nowSec = toSeconds(nowTime);

  const result = new Map();
  for (const { iso, weekday } of dayList) {
    const times = new Set();
    const onTimeOff = vacations.some((v) => !v.st && iso >= v.s && iso <= v.e);
    const partial = vacations.filter((v) => v.st && iso >= v.s && iso <= v.e);
    if (!onTimeOff && iso >= today) {
      for (const slot of slots) {
        if (Number(slot.weekday) !== weekday) continue;
        const from = toSeconds(slot.start_time);
        const to = toSeconds(slot.end_time);
        for (let t = from; t + SESSION_SECONDS <= to; t += STEP) {
          if (iso === today && t <= nowSec) continue;
          const inPartial = partial.some((v) => t < toSeconds(v.et) && t + SESSION_SECONDS > toSeconds(v.st));
          const overlaps = inPartial || (busy.get(iso) || []).some(([bs, be]) => t < be && t + SESSION_SECONDS > bs);
          if (!overlaps) times.add(toTime(t));
        }
      }
    }
    result.set(iso, [...times].sort());
  }
  return result;
}

module.exports = { bookableTimes, toSeconds, toTime };
