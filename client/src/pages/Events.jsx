import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api, { errorMessage } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useUserLocation } from '../hooks/useUserLocation.js';
import { CATEGORIES, formatRange, formatShift, makeGoogleMapsDirectionsUrl } from '../lib.js';
import { EventBadge, Empty, Notice, Spinner } from '../components/ui.jsx';

// Distinct Vibrant Neo-Brutalist Pastel Palette for Event Card Headers
const CARD_HEADER_PALETTE = [
  '#bbf7d0', // Mint Green
  '#ddd6fe', // Soft Lavender
  '#fef08a', // Butter Yellow
  '#fecdd3', // Soft Rose / Peach
  '#bae6fd', // Sky Blue
  '#fed7aa', // Warm Apricot
  '#e9d5ff', // Lilac
  '#a7f3d0', // Seafoam
  '#fbcfe8', // Bubblegum Pink
  '#99f6e4', // Mint Turquoise
  '#fde68a', // Amber Gold Pastel
  '#c7d2fe', // Periwinkle Blue
  '#fed7d7', // Coral Pastel
  '#bfdbfe', // Ice Blue
];

export default function Events() {
  const { user } = useAuth();
  const { getDistance } = useUserLocation();
  const isOrganizer = Boolean(user && ['organizer', 'admin'].includes(user.role));
  const [filters, setFilters] = useState({ q: '', city: '', category: '' });
  const [applied, setApplied] = useState(filters);
  const [page, setPage] = useState(1);

  // If user is an organizer, fetch only this particular organizer's events
  const {
    data: organizerData,
    isLoading: isOrgLoading,
    error: orgError,
  } = useQuery({
    queryKey: ['my-events-all', user?.id],
    queryFn: async () => (await api.get('/events/mine')).data,
    enabled: isOrganizer,
    refetchInterval: 15_000,
  });

  // If user is a volunteer (crew) or public, query all published events listed by ANY organizer
  const {
    data: publicData,
    isLoading: isPubLoading,
    error: pubError,
    isFetching,
  } = useQuery({
    queryKey: ['events-public', applied, page],
    queryFn: async () => {
      const params = { page, limit: 12 };
      for (const [k, v] of Object.entries(applied)) if (v) params[k] = v;
      return (await api.get('/events', { params })).data;
    },
    enabled: !isOrganizer,
    placeholderData: (prev) => prev,
  });

  // For crew / volunteers: fetch their shifts to spotlight ongoing or upcoming volunteer commitments
  const { data: myShifts = [], isLoading: isShiftsLoading } = useQuery({
    queryKey: ['my-shifts'],
    queryFn: async () => (await api.get('/me/shifts')).data.signups,
    enabled: Boolean(user && !isOrganizer),
    refetchInterval: 15_000,
  });

  const isLoading = isOrganizer ? isOrgLoading : isPubLoading;
  const error = isOrganizer ? orgError : pubError;

  // Events belonging to this organizer (or all public events across organizers for volunteers)
  const allEvents = isOrganizer ? organizerData?.events || [] : publicData?.events || [];

  // Filter events matching the search/category bar
  const displayEvents = useMemo(() => {
    if (!isOrganizer) return publicData?.events || [];
    return allEvents.filter((ev) => {
      if (applied.q) {
        const q = applied.q.toLowerCase().trim();
        const inTitle = ev.title?.toLowerCase().includes(q);
        const inDesc = ev.description?.toLowerCase().includes(q);
        const inVenue = ev.venue?.name?.toLowerCase().includes(q);
        if (!inTitle && !inDesc && !inVenue) return false;
      }
      if (applied.city) {
        const city = applied.city.toLowerCase().trim();
        if (!ev.venue?.city?.toLowerCase().includes(city)) return false;
      }
      if (applied.category) {
        if (ev.category !== applied.category) return false;
      }
      return true;
    });
  }, [isOrganizer, allEvents, publicData, applied]);

  // Featured Event for the Yellow Container:
  // For Volunteers (Crew):
  // 1. Ongoing Event they are currently volunteering for (Live on duty)
  // 2. Upcoming Event they have volunteered for (Next confirmed shift)
  // 3. Pending/Waitlisted Event they applied for
  // 4. Fallback: Earliest upcoming public event open for registration
  // For Organizers:
  // 1. Ongoing event of theirs -> 2. Upcoming event of theirs -> 3. Fallback
  const { featuredEvent, featuredType, crewShift } = useMemo(() => {
    const now = new Date();

    const isOngoing = (ev) => {
      if (!ev) return false;
      if (ev.status === 'ongoing') return true;
      if (!ev.startDate || !ev.endDate) return false;
      const s = new Date(ev.startDate);
      const e = new Date(ev.endDate);
      return s <= now && e >= now;
    };

    const isUpcoming = (ev) => {
      if (!ev || !ev.startDate) return false;
      return new Date(ev.startDate) > now;
    };

    // --- CREW / VOLUNTEER SIDE LOGIC ---
    if (!isOrganizer) {
      if (myShifts.length > 0) {
        // 1. Ongoing shift the crew is currently volunteering for
        const ongoingShift = myShifts.find((s) => {
          if (!s.shift) return false;
          const start = new Date(s.shift.start);
          const end = new Date(s.shift.end);
          const timeActive = start <= now && end >= now;
          const isCheckedIn = s.attendance?.status === 'checked_in';
          return s.status === 'confirmed' && (timeActive || isCheckedIn);
        });

        if (ongoingShift && ongoingShift.event) {
          return {
            featuredEvent: ongoingShift.event,
            featuredType: 'crew_ongoing',
            crewShift: ongoingShift,
          };
        }

        // 2. Next upcoming shift the crew has volunteered for (earliest start first)
        const upcomingConfirmedShifts = myShifts
          .filter(
            (s) =>
              s.shift &&
              new Date(s.shift.start) > now &&
              s.status === 'confirmed'
          )
          .sort((a, b) => new Date(a.shift.start) - new Date(b.shift.start));

        if (upcomingConfirmedShifts.length > 0 && upcomingConfirmedShifts[0].event) {
          return {
            featuredEvent: upcomingConfirmedShifts[0].event,
            featuredType: 'crew_upcoming',
            crewShift: upcomingConfirmedShifts[0],
          };
        }

        // 3. Pending or waitlisted shift application
        const pendingShifts = myShifts
          .filter(
            (s) =>
              s.shift &&
              new Date(s.shift.end) >= now &&
              ['pending', 'waitlisted'].includes(s.status)
          )
          .sort((a, b) => new Date(a.shift.start) - new Date(b.shift.start));

        if (pendingShifts.length > 0 && pendingShifts[0].event) {
          return {
            featuredEvent: pendingShifts[0].event,
            featuredType: 'crew_pending',
            crewShift: pendingShifts[0],
          };
        }
      }

      // 4. Fallback if crew hasn't volunteered for any upcoming shifts:
      // Show next upcoming public event to volunteer for
      const publicList = publicData?.events || [];
      const publicOngoing = publicList.filter(isOngoing);
      if (publicOngoing.length > 0) {
        return {
          featuredEvent: publicOngoing[0],
          featuredType: 'public_ongoing',
          crewShift: null,
        };
      }

      const publicUpcoming = publicList
        .filter(isUpcoming)
        .sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
      if (publicUpcoming.length > 0) {
        return {
          featuredEvent: publicUpcoming[0],
          featuredType: 'public_upcoming',
          crewShift: null,
        };
      }

      const sorted = [...publicList].sort((a, b) => new Date(b.startDate) - new Date(a.startDate));
      return {
        featuredEvent: sorted[0] || null,
        featuredType: 'public_fallback',
        crewShift: null,
      };
    }

    // --- ORGANIZER SIDE LOGIC ---
    const list = organizerData?.events || [];
    if (!list.length) return { featuredEvent: null, featuredType: 'none', crewShift: null };

    // 1. Ongoing events of this organizer
    const orgOngoing = list
      .filter(isOngoing)
      .sort((a, b) => new Date(a.startDate) - new Date(b.startDate));

    if (orgOngoing.length > 0) {
      return { featuredEvent: orgOngoing[0], featuredType: 'org_ongoing', crewShift: null };
    }

    // 2. Upcoming events sorted by date ascending
    const orgUpcoming = list
      .filter(isUpcoming)
      .sort((a, b) => new Date(a.startDate) - new Date(b.startDate));

    if (orgUpcoming.length > 0) {
      return { featuredEvent: orgUpcoming[0], featuredType: 'org_upcoming', crewShift: null };
    }

    // 3. Fallback: most recent or earliest event
    const sorted = [...list].sort((a, b) => new Date(b.startDate) - new Date(a.startDate));
    return { featuredEvent: sorted[0], featuredType: 'org_fallback', crewShift: null };
  }, [isOrganizer, myShifts, publicData, organizerData]);

  const submit = (e) => {
    e.preventDefault();
    setPage(1);
    setApplied(filters);
  };
  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="events-page-bento">
      {/* Full-width Explore Roles / Search Filter Container */}
      <div className="bento-filter-container full-width-filter">
        <div className="filter-title-row">
          <h2 className="explore-section-title">
            {isOrganizer ? 'YOUR ORGANIZED EVENTS' : 'EXPLORE ALL EVENTS & VOLUNTEER ROLES'}
          </h2>
          <span className="explore-count-tag">
            {displayEvents.length} {displayEvents.length === 1 ? 'Event' : 'Events'}
          </span>
        </div>

        <form className="bento-filters" onSubmit={submit}>
          <div className="filter-input-wrap">
            <svg className="filter-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            <input
              aria-label="Search by title or venue"
              placeholder={isOrganizer ? "Search your events..." : "Search all events by title, venue, or keywords..."}
              value={filters.q}
              onChange={set('q')}
            />
          </div>

          <div className="filter-input-wrap">
            <svg className="filter-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
              <circle cx="12" cy="10" r="3"></circle>
            </svg>
            <input
              aria-label="City"
              placeholder="Filter by city location..."
              value={filters.city}
              onChange={set('city')}
            />
          </div>

          <div className="filter-input-wrap">
            <select aria-label="Category" value={filters.category} onChange={set('category')}>
              <option value="">All Categories</option>
              {Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>

          <button className="bento-search-btn" type="submit">
            <span>Search</span>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12"></line>
              <polyline points="12 5 19 12 12 19"></polyline>
            </svg>
          </button>
        </form>
      </div>

      {/* Full-length Yellow Container */}
      <div className="bento-upcoming-banner full-width-banner">
        <div className="upcoming-content-left">
          {featuredType === 'crew_ongoing' ? (
            <span className="upcoming-label-tag live-tag">
              <span className="live-pulse-dot" />
              🟢 YOU ARE ON DUTY NOW
            </span>
          ) : featuredType === 'crew_upcoming' ? (
            <span className="upcoming-label-tag" style={{ background: '#bbf7d0', color: '#166534', border: '1.5px solid #0f172a' }}>
              ⚡ YOUR NEXT VOLUNTEER SHIFT
            </span>
          ) : featuredType === 'crew_pending' ? (
            <span className="upcoming-label-tag" style={{ background: '#fed7aa', color: '#9a3412', border: '1.5px solid #0f172a' }}>
              ⏳ APPLICATION PENDING APPROVAL
            </span>
          ) : featuredType === 'public_ongoing' || featuredType === 'org_ongoing' ? (
            <span className="upcoming-label-tag live-tag">
              <span className="live-pulse-dot" />
              HAPPENING NOW
            </span>
          ) : featuredType === 'public_upcoming' ? (
            <span className="upcoming-label-tag">DISCOVER & VOLUNTEER</span>
          ) : featuredType === 'org_upcoming' ? (
            <span className="upcoming-label-tag">NEXT UPCOMING EVENT</span>
          ) : (
            <span className="upcoming-label-tag">FEATURED OPPORTUNITY</span>
          )}

          <h2 className="upcoming-event-title">
            {featuredEvent
              ? featuredEvent.title
              : isOrganizer
              ? 'NO EVENTS SCHEDULED'
              : 'EXPLORE VOLUNTEER ROLES'}
          </h2>

          <p className="upcoming-event-date">
            {crewShift ? (
              <span>
                <strong>Assigned Role: {crewShift.role}</strong> • {formatShift(crewShift.shift?.start, crewShift.shift?.end)}
                {featuredEvent?.venue?.city ? ` • 📍 ${featuredEvent.venue.city}` : ''}
              </span>
            ) : featuredEvent ? (
              `${formatRange(featuredEvent.startDate, featuredEvent.endDate)} • ${
                featuredEvent.venue?.city || 'Local'
              }${featuredEvent.venue?.name ? `, ${featuredEvent.venue.name}` : ''}`
            ) : isOrganizer ? (
              'Create your first event to get started'
            ) : (
              'Discover open shifts, earn verified hours, and join exciting crews!'
            )}
          </p>

          {crewShift ? (
            <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap', alignItems: 'center' }}>
              {crewShift.status === 'confirmed' && (
                <Link
                  to={`/pass/${crewShift.shift._id}`}
                  className="upcoming-action-btn"
                  style={{ background: '#0f172a', color: '#ffffff' }}
                >
                  <span>🎫 Open My QR Pass</span>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                    <polyline points="12 5 19 12 12 19"></polyline>
                  </svg>
                </Link>
              )}
              <Link to={`/events/${featuredEvent._id}`} className="upcoming-action-btn">
                <span>View Event Details</span>
              </Link>
            </div>
          ) : featuredEvent ? (
            <Link to={`/events/${featuredEvent._id}`} className="upcoming-action-btn">
              <span>{isOrganizer ? 'View Event Details' : 'Explore Shifts & Join Crew →'}</span>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12"></line>
                <polyline points="12 5 19 12 12 19"></polyline>
              </svg>
            </Link>
          ) : isOrganizer ? (
            <Link to="/manage/events/new" className="upcoming-action-btn">
              <span>+ Create Event</span>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
            </Link>
          ) : null}
        </div>

        <div className="upcoming-megaphone-container" aria-hidden="true">
          <svg width="95" height="95" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M25 40 L55 24 L55 76 L25 60 Z" fill="#fecdd3" stroke="#0f172a" strokeWidth="4" strokeLinejoin="round" />
            <ellipse cx="55" cy="50" rx="6" ry="26" fill="#fda4af" stroke="#0f172a" strokeWidth="4" />
            <path d="M30 60 L30 76 L38 76 L38 60" fill="#e9d5ff" stroke="#0f172a" strokeWidth="4" strokeLinejoin="round" />
            <path d="M25 43 L17 45 C15 45 13 47 13 50 C13 53 15 55 17 55 L25 57 Z" fill="#bae6fd" stroke="#0f172a" strokeWidth="4" strokeLinejoin="round" />
            <path d="M68 35 C74 44 74 56 68 65" stroke="#0f172a" strokeWidth="4" strokeLinecap="round" />
            <path d="M78 27 C88 41 88 59 78 73" stroke="#0f172a" strokeWidth="4" strokeLinecap="round" />
          </svg>
        </div>
      </div>

      <Notice>{error && errorMessage(error)}</Notice>

      {isLoading ? (
        <Spinner />
      ) : displayEvents.length ? (
        <>
          {/* Bento Grid with every single card having a different header color */}
          <div className="bento-grid" aria-busy={isFetching}>
            {displayEvents.map((ev, index) => (
              <EventBadge
                key={ev._id}
                event={ev}
                to={`/events/${ev._id}`}
                headerColor={CARD_HEADER_PALETTE[index % CARD_HEADER_PALETTE.length]}
                distanceText={getDistance(ev.venue)}
                footer={
                  isOrganizer && ev.needsVolunteerPayout ? (
                    <div
                      style={{
                        marginTop: '0.65rem',
                        padding: '0.65rem',
                        background: '#fef2f2',
                        border: '2px solid #ef4444',
                        borderRadius: '8px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.4rem',
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <span style={{ fontSize: '1rem' }}>⚠️</span>
                        <strong style={{ fontSize: '0.78rem', color: '#991b1b' }}>
                          Action Required: Pay Volunteers ({ev.unpaidCrewCount || 1} pending)
                        </strong>
                      </div>
                      <p style={{ margin: 0, fontSize: '0.72rem', color: '#7f1d1d', lineHeight: 1.25 }}>
                        Event is completed. Release crew stipends to settle and archive this event.
                      </p>
                      <Link
                        to={`/manage/events/${ev._id}?tab=funds`}
                        className="btn btn-primary"
                        style={{ fontSize: '0.74rem', padding: '0.3rem 0.65rem', fontWeight: 800, textAlign: 'center', justifyContent: 'center' }}
                      >
                        💰 Pay Volunteers Now →
                      </Link>
                    </div>
                  ) : null
                }
              />
            ))}
          </div>

          {!isOrganizer && publicData?.pages > 1 && (
            <div className="bento-pager">
              <button className="bento-page-btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                ← Previous
              </button>
              <span className="bento-page-info">Page {publicData.page} of {publicData.pages}</span>
              <button className="bento-page-btn" disabled={page >= publicData.pages} onClick={() => setPage((p) => p + 1)}>
                Next →
              </button>
            </div>
          )}
        </>
      ) : (
        <Empty title={isOrganizer ? "No events found" : "No events match"}>
          {isOrganizer
            ? "You don't have any events matching this filter. Try clearing the search or click '+ Create Event' in the top navbar to add one!"
            : "No events match your search. Try searching for a different city or clearing keywords to see all events open across all organizers."}
        </Empty>
      )}
    </div>
  );
}
