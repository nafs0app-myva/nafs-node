/** Wall-clock `YYYY-MM-DD HH:mm:ss` of an instant in a timezone. */
function wallClock(date, timeZone) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).format(date);
}

/** Offset in ms of `timeZone` from UTC at `date` (positive east of UTC). */
function zoneOffsetMs(date, timeZone) {
  const asUtc = new Date(`${wallClock(date, timeZone).replace(' ', 'T')}Z`);
  return asUtc.getTime() - Math.floor(date.getTime() / 1000) * 1000;
}

/** The UTC instant for a wall-clock `date` (YYYY-MM-DD) + `time` (HH:mm[:ss]) in `timeZone`. */
function zonedToUtc(date, time, timeZone) {
  const naive = new Date(`${date}T${String(time).slice(0, 8).padEnd(8, ':00').slice(0, 8)}Z`);
  let utc = new Date(naive.getTime() - zoneOffsetMs(naive, timeZone));
  utc = new Date(naive.getTime() - zoneOffsetMs(utc, timeZone)); // settle across DST changes
  return utc;
}

/** `YYYY-MM-DD HH:mm:ss` (UTC) for storing in a DATETIME column. */
const toMysqlUtc = (d) => d.toISOString().slice(0, 19).replace('T', ' ');

module.exports = { wallClock, zoneOffsetMs, zonedToUtc, toMysqlUtc };
