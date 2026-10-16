// Formatters must never throw: one bad value should not blank a whole page.
const safe = (fn, fallback = '') => (...args) => { try { return fn(...args); } catch { return fallback; } };

const dateFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const shortFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' });

function rawFormatRange(start, end) {
  const s = new Date(start);
  const e = new Date(end);
  if (s.toDateString() === e.toDateString()) return dateFmt.format(s);
  return `${shortFmt.format(s)} to ${dateFmt.format(e)}`;
}

export const formatRange = safe(rawFormatRange, 'Date to be confirmed');

// <input type="date"> uses local calendar dates, so convert without shifting the day.
export function toInputDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export const startOfDayISO = (s) => new Date(`${s}T00:00:00`).toISOString();
export const endOfDayISO = (s) => new Date(`${s}T23:59:59`).toISOString();

export const CATEGORIES = {
  college_fest: 'College fest',
  hackathon: 'Hackathon',
  ngo_drive: 'NGO drive',
  sports: 'Sports',
  conference: 'Conference',
  community: 'Community',
  other: 'Other',
};

export const ORG_TYPES = {
  college_club: 'College club',
  ngo: 'NGO',
  fest_committee: 'Fest committee',
  company: 'Company',
  other: 'Other',
};

export const STATUS_LABEL = {
  draft: 'Draft',
  published: 'Published',
  ongoing: 'Ongoing',
  completed: 'Completed',
  settled: 'Settled',
  cancelled: 'Cancelled',
};

const dtFmt = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const timeFmt = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit' });
export const formatDateTime = safe((d) => dtFmt.format(new Date(d)), '');
export const formatTime = safe((d) => timeFmt.format(new Date(d)), '');
function rawFormatShift(start, end) {
  const s = new Date(start), e = new Date(end);
  return s.toDateString() === e.toDateString() ? `${dtFmt.format(s)} to ${timeFmt.format(e)}` : `${dtFmt.format(s)} to ${dtFmt.format(e)}`;
}
export const formatShift = safe(rawFormatShift, 'Time to be confirmed');
export const rupees = (paise) => `Rs ${((paise || 0) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
export const hoursText = (m) => `${Math.floor((m || 0) / 60)}h ${String((m || 0) % 60).padStart(2, '0')}m`;
export const payLabel = (s, maybeType) => {
  if (!s) return 'Unpaid';
  const payType = typeof s === 'object' ? (s.payType || 'unpaid') : (maybeType || 'unpaid');
  const rate = typeof s === 'object' ? (s.rate ?? s.payRate ?? 0) : (s || 0);
  if (payType === 'hourly') return `${rupees(rate)} per hour`;
  if (payType === 'flat') return `${rupees(rate)} flat`;
  return 'Unpaid';
};
export const toIso = (localValue) => (localValue ? new Date(localValue).toISOString() : undefined);

export const SHIFT_STATE = { open: 'Open', full: 'Full', in_progress: 'In progress', completed: 'Completed', cancelled: 'Cancelled' };
export const SIGNUP_LABEL = { confirmed: 'Confirmed', pending: 'Awaiting approval', waitlisted: 'On waitlist', cancelled: 'Cancelled', rejected: 'Declined' };
export const ATT_LABEL = { expected: 'Expected', checked_in: 'Checked in', completed: 'Checked out', no_show: 'No-show', approved: 'Approved', rejected: 'Rejected' };

export function makeGoogleMapsDirectionsUrl(venue) {
  if (!venue) return '#';
  const query = [venue.name, venue.address, venue.city].filter(Boolean).join(', ');
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(query)}`;
}

export function makeGoogleMapsSearchUrl(venue) {
  if (!venue) return '#';
  const query = [venue.name, venue.address, venue.city].filter(Boolean).join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

export const CITY_COORDINATES = {
  mumbai: [19.076, 72.8777],
  pune: [18.5204, 73.8567],
  delhi: [28.7041, 77.1025],
  'new delhi': [28.6139, 77.209],
  bengaluru: [12.9716, 77.5946],
  bangalore: [12.9716, 77.5946],
  hyderabad: [17.385, 78.4867],
  chennai: [13.0827, 80.2707],
  kolkata: [22.5726, 88.3639],
  ahmedabad: [23.0225, 72.5714],
  jaipur: [26.9124, 75.7873],
  noida: [28.5355, 77.391],
  gurgaon: [28.4595, 77.0266],
  gurugram: [28.4595, 77.0266],
  chandigarh: [30.7333, 76.7794],
  lucknow: [26.8467, 80.9462],
  indore: [22.7196, 75.8577],
  bhopal: [23.2599, 77.4126],
  nagpur: [21.1458, 79.0882],
  kochi: [9.9312, 76.2673],
  coimbatore: [11.0168, 76.9558],
  visakhapatnam: [17.6868, 83.2185],
  patna: [25.5941, 85.1376],
};

export function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  if (!lat1 || !lon1 || !lat2 || !lon2) return null;
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const d = R * c;
  return Math.round(d * 10) / 10;
}

export function getVenueDistanceText(venue, userCoords, userCity) {
  if (!venue) return null;

  let venueLat = venue.geo?.coordinates?.[1];
  let venueLng = venue.geo?.coordinates?.[0];

  if ((!venueLat || !venueLng) && venue.city) {
    const coords = CITY_COORDINATES[venue.city.toLowerCase().trim()];
    if (coords) {
      venueLat = coords[0];
      venueLng = coords[1];
    }
  }

  let uLat = userCoords?.latitude;
  let uLng = userCoords?.longitude;

  if ((!uLat || !uLng) && userCity) {
    const coords = CITY_COORDINATES[userCity.toLowerCase().trim()];
    if (coords) {
      uLat = coords[0];
      uLng = coords[1];
    }
  }

  if (venueLat && venueLng && uLat && uLng) {
    const km = calculateDistanceKm(uLat, uLng, venueLat, venueLng);
    if (km !== null) {
      if (km < 1) return '< 1 km away';
      return `${km} km away`;
    }
  }

  if (userCity && venue.city && userCity.toLowerCase().trim() === venue.city.toLowerCase().trim()) {
    return 'In your city';
  }

  return null;
}

