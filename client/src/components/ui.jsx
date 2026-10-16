import { Link } from 'react-router-dom';
import { CATEGORIES, STATUS_LABEL, formatRange } from '../lib.js';

export function Field({ label, error, hint, children }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && !error && <span className="field-hint">{hint}</span>}
      {error && <span className="field-error" role="alert">{error}</span>}
    </label>
  );
}

export function Notice({ tone = 'error', children }) {
  if (!children) return null;
  return <div className={`notice notice-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>{children}</div>;
}

export function StatusChip({ status }) {
  return <span className={`chip chip-${status}`}>{STATUS_LABEL[status] || status}</span>;
}

export function Empty({ title, children }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}

// Neo-Brutalist Bento Event Card
export function EventBadge({ event, to, footer, headerColor, distanceText }) {
  const categoryColorClass = `cat-${event.category || 'general'}`;
  const isOngoing =
    event.status === 'ongoing' ||
    (event.startDate &&
      event.endDate &&
      new Date(event.startDate) <= new Date() &&
      new Date(event.endDate) >= new Date());

  const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
    [event.venue?.name, event.venue?.address, event.venue?.city].filter(Boolean).join(', ')
  )}`;

  const body = (
    <div className={`bento-card-inner ${categoryColorClass}`}>
      <div
        className="card-top-bar"
        style={headerColor ? { backgroundColor: headerColor } : undefined}
      >
        <span className="bento-badge-cat">{CATEGORIES[event.category] || 'Event'}</span>
        {isOngoing ? (
          <span className="card-live-indicator" title="Happening Now">
            <span className="live-pulse-dot" />
            <span className="card-live-text">LIVE</span>
          </span>
        ) : (
          <span className="bento-card-dot" />
        )}
      </div>
      <div className="badge-body">
        <h3 className="badge-title">{event.title}</h3>
        <div className="badge-meta-row">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="16" y1="2" x2="16" y2="6"></line>
            <line x1="8" y1="2" x2="8" y2="6"></line>
            <line x1="3" y1="10" x2="21" y2="10"></line>
          </svg>
          <span>{formatRange(event.startDate, event.endDate)}</span>
        </div>
        <div className="badge-meta-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', minWidth: 0, overflow: 'hidden' }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
              <circle cx="12" cy="10" r="3"></circle>
            </svg>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {event.venue?.city}{event.venue?.name ? `, ${event.venue.name}` : ''}
            </span>
          </div>
          {distanceText && (
            <span style={{ flexShrink: 0, background: '#dcfce7', color: '#166534', border: '1px solid #86efac', padding: '1px 6px', borderRadius: '4px', fontSize: '0.72rem', fontWeight: 800 }}>
              📍 {distanceText}
            </span>
          )}
        </div>
        {event.organization?.name && (
          <div className="badge-org-row">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
              <circle cx="9" cy="7" r="4"></circle>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
            </svg>
            <span>Run by {event.organization.name}</span>
          </div>
        )}
        <div className="card-action-bar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="card-action-btn">
            View Details
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12"></line>
              <polyline points="12 5 19 12 12 19"></polyline>
            </svg>
          </span>
          {event.venue && (
            <a
              href={directionsUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              style={{ fontSize: '0.74rem', fontWeight: 800, color: '#0369a1', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '3px' }}
              title="Open turn-by-turn directions in Google Maps"
            >
              🗺️ Directions ↗
            </a>
          )}
        </div>
        {footer}
      </div>
    </div>
  );
  return to ? <Link to={to} className="bento-event-badge">{body}</Link> : <div className="bento-event-badge">{body}</div>;
}

export function Spinner({ label = 'Loading' }) {
  return <div className="spinner" role="status" aria-label={label}><span /></div>;
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} className={value === t.id ? 'tab on' : 'tab'} onClick={() => onChange(t.id)}>
          {t.label}{t.badge ? <span className="tab-badge">{t.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Stat({ label, value, hint }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      {hint && <span className="stat-hint">{hint}</span>}
    </div>
  );
}

export function Pill({ tone = 'neutral', children }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}
