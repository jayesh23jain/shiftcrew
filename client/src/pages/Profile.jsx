import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import api, { errorMessage, fieldErrors } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Field, Notice } from '../components/ui.jsx';

const toList = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);

export default function Profile() {
  const { user, setUser } = useAuth();
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState({
    name: user.name || '',
    phone: user.phone || '',
    city: user.city || '',
    bio: user.bio || '',
    skills: (user.skills || []).join(', '),
    languages: (user.languages || []).join(', '),
    ecName: user.emergencyContact?.name || '',
    ecPhone: user.emergencyContact?.phone || '',
    emailNotifications: user.emailNotifications !== false,
  });
  const [saved, setSaved] = useState(false);

  const m = useMutation({
    mutationFn: async () =>
      (await api.patch('/users/me', {
        name: form.name,
        phone: form.phone,
        city: form.city,
        bio: form.bio,
        skills: toList(form.skills),
        languages: toList(form.languages),
        emergencyContact: { name: form.ecName, phone: form.ecPhone },
        emailNotifications: form.emailNotifications,
      })).data,
    onSuccess: (d) => {
      setUser(d.user);
      setSaved(true);
    },
  });

  const errors = m.error ? fieldErrors(m.error) : {};
  const set = (k) => (e) => {
    setSaved(false);
    setForm({ ...form, [k]: e.target.value });
  };

  const initial = user.name ? user.name.charAt(0).toUpperCase() : 'U';
  const displaySkills = user.skills?.length
    ? user.skills
    : ['Event Logistics', 'Stage Crew', 'Hospitality', 'Ticketing'];

  return (
    <div className="profile-page-wrapper">
      {/* 1. Profile Bento Card (Matching Reference Layout) */}
      <div className="profile-card-bento">
        {/* Vibrant Gradient Cover Banner */}
        <div className="profile-cover-banner">
          <button
            type="button"
            className="profile-banner-btn"
            title="Edit Profile"
            onClick={() => setEditOpen(!editOpen)}
            aria-label="Edit Profile"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
          </button>
        </div>

        {/* Profile Card Body */}
        <div className="profile-body-content">
          {/* Overlapping Avatar */}
          <div className="profile-avatar-row">
            <div className="profile-avatar-large">
              {initial}
            </div>
            <span
              className="dash-alert-badge"
              style={{
                background: user.role === 'organizer' ? '#ddd6fe' : '#bbf7d0',
                color: '#0f172a',
                fontSize: '0.78rem',
                padding: '4px 12px',
              }}
            >
              {user.role === 'organizer' ? 'Organizer Account' : 'Volunteer Crew'}
            </span>
          </div>

          {/* Main Grid: User Identity Left, Role & Skills Right */}
          <div className="profile-main-grid">
            {/* Left: Name, Role Headline, Location, Action Buttons */}
            <div>
              <h1 className="profile-name">{user.name || 'Your Name'}</h1>
              <p className="profile-headline">
                {user.bio ? (user.bio.length > 70 ? user.bio.substring(0, 70) + '...' : user.bio) : (user.role === 'organizer' ? 'Lead Event Organizer' : 'Crew Specialist & Volunteer')}
              </p>
              <div className="profile-location">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                  <circle cx="12" cy="10" r="3"></circle>
                </svg>
                <span>{user.city ? `${user.city}` : 'City not specified'}</span>
                <span style={{ color: '#cbd5e1' }}>•</span>
                <span>{user.email}</span>
              </div>

              <div className="profile-actions-row">
                <button
                  type="button"
                  className="profile-btn-dark"
                  onClick={() => setEditOpen(!editOpen)}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                  </svg>
                  {editOpen ? 'Hide Editor' : 'Edit Profile'}
                </button>
                <button
                  type="button"
                  className="profile-btn-light"
                  onClick={() => {
                    setEditOpen(true);
                    setTimeout(() => {
                      document.getElementById('profile-edit-section')?.scrollIntoView({ behavior: 'smooth' });
                    }, 80);
                  }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3"></circle>
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                  </svg>
                  Settings
                </button>
              </div>
            </div>

            {/* Right: Current Role Pill & Skills Pills Row */}
            <div className="profile-right-meta">
              <div className="profile-meta-section">
                <span className="profile-meta-header">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
                    <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
                  </svg>
                  Current role
                </span>
                <span className="profile-role-pill">
                  {user.role === 'organizer' ? 'Lead Event Organizer' : 'Verified Crew Volunteer'}
                </span>
              </div>

              <div className="profile-meta-section">
                <span className="profile-meta-header">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                  </svg>
                  Skills
                </span>
                <div className="profile-skills-pills">
                  {displaySkills.map((sk, idx) => {
                    const colors = ['#fecdd3', '#fef08a', '#bbf7d0', '#bae6fd', '#fed7aa', '#ddd6fe'];
                    const bg = colors[idx % colors.length];
                    return (
                      <span key={sk} className="profile-skill-chip" style={{ background: bg }}>
                        {sk}
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* 3 Quick Highlight Bento Tiles (From Reference Image) */}
          <div className="profile-highlights-row">
            <Link to={user.role === 'organizer' ? '/events' : '/events'} className="profile-tile-bento">
              <div className="profile-tile-left">
                <strong className="profile-tile-title">Ready for shifts</strong>
                <span className="profile-tile-desc">
                  {user.role === 'organizer'
                    ? 'Publish new events and manage volunteer shifts.'
                    : 'Show organizers you are ready to work & join events.'}
                </span>
              </div>
              <div className="profile-tile-arrow-circle">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                  <polyline points="12 5 19 12 12 19"></polyline>
                </svg>
              </div>
            </Link>

            <Link to="/certificates" className="profile-tile-bento">
              <div className="profile-tile-left">
                <strong className="profile-tile-title">Verified Badges</strong>
                <span className="profile-tile-desc">
                  Share verified credentials and reliable work hours.
                </span>
              </div>
              <div className="profile-tile-arrow-circle">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                  <polyline points="12 5 19 12 12 19"></polyline>
                </svg>
              </div>
            </Link>

            <Link to="/earnings" className="profile-tile-bento">
              <div className="profile-tile-left">
                <strong className="profile-tile-title">Earnings & Hours</strong>
                <span className="profile-tile-desc">
                  Keep track of logged shift attendance and payouts.
                </span>
              </div>
              <div className="profile-tile-arrow-circle">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                  <polyline points="12 5 19 12 12 19"></polyline>
                </svg>
              </div>
            </Link>
          </div>
        </div>
      </div>

      {/* 2. Neo-Brutalist Profile Edit Form Card */}
      <div id="profile-edit-section" className="bento-form-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <h2 style={{ fontSize: '1.35rem', fontWeight: 950, color: '#0f172a', margin: '0 0 0.25rem' }}>
              Edit Profile Details
            </h2>
            <p style={{ fontSize: '0.88rem', color: '#64748b', margin: 0, fontWeight: 600 }}>
              Update your contact info, public bio, skills, and emergency contact details.
            </p>
          </div>
          {saved && (
            <span className="dash-alert-badge" style={{ background: '#bbf7d0', color: '#0f172a', padding: '4px 12px' }}>
              ✓ Profile Saved
            </span>
          )}
        </div>

        <form onSubmit={(e) => { e.preventDefault(); m.mutate(); }} noValidate>
          <Notice>{m.error && errorMessage(m.error)}</Notice>
          <Notice tone="success">{saved && 'Your profile changes have been successfully saved!'}</Notice>

          {/* Section 1: Personal Details */}
          <div className="bento-form-section">
            <div className="bento-section-header">
              <span className="bento-section-badge badge-yellow">1</span>
              <h3 className="bento-section-title">Personal Information</h3>
            </div>

            <Field label="Full Name" error={errors.name}>
              <input value={form.name} onChange={set('name')} placeholder="Your name" required />
            </Field>

            <div className="two">
              <Field label="Phone Number" error={errors.phone}>
                <input value={form.phone} onChange={set('phone')} placeholder="+91 98765 43210" />
              </Field>
              <Field label="City / Region" error={errors.city}>
                <input value={form.city} onChange={set('city')} placeholder="e.g. Mumbai, Delhi, Bengaluru" />
              </Field>
            </div>

            <Field label="About You / Bio" error={errors.bio} hint="A brief introduction for event organizers & teammates.">
              <textarea
                rows={3}
                value={form.bio}
                onChange={set('bio')}
                placeholder="Share your experience, specialties, and event availability..."
              />
            </Field>
          </div>

          {/* Section 2: Skills & Languages */}
          <div className="bento-form-section">
            <div className="bento-section-header">
              <span className="bento-section-badge badge-mint">2</span>
              <h3 className="bento-section-title">Skills & Languages</h3>
            </div>

            <Field
              label="Skills (Comma-separated)"
              hint="e.g. Audio Engineering, Crowd Management, First Aid, Photography, Stage Hand"
            >
              <input
                value={form.skills}
                onChange={set('skills')}
                placeholder="First Aid, Photography, Sound Check, Stage Hand"
              />
            </Field>

            <Field
              label="Languages Spoken"
              hint="e.g. English, Hindi, Punjabi, Spanish"
            >
              <input
                value={form.languages}
                onChange={set('languages')}
                placeholder="English, Hindi"
              />
            </Field>
          </div>

          {/* Section 3: Emergency Contact */}
          <div className="bento-form-section">
            <div className="bento-section-header">
              <span className="bento-section-badge badge-lavender">3</span>
              <h3 className="bento-section-title">Emergency Contact Details</h3>
            </div>

            <div className="two">
              <Field label="Contact Person Name">
                <input
                  value={form.ecName}
                  onChange={set('ecName')}
                  placeholder="Parent, Spouse, or Guardian name"
                />
              </Field>
              <Field label="Contact Phone Number">
                <input
                  value={form.ecPhone}
                  onChange={set('ecPhone')}
                  placeholder="+91 98765 43210"
                />
              </Field>
            </div>
          </div>

          {/* Section 4: Notification Preferences */}
          <div className="bento-form-section" style={{ borderBottom: 'none', marginBottom: '0.5rem' }}>
            <div className="bento-section-header">
              <span className="bento-section-badge badge-sky">4</span>
              <h3 className="bento-section-title">Notifications & Security</h3>
            </div>

            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                cursor: 'pointer',
                background: '#f8fafc',
                border: '2px solid #0f172a',
                borderRadius: '14px',
                padding: '0.85rem 1.15rem',
                fontWeight: 750,
                fontSize: '0.92rem',
                color: '#0f172a',
              }}
            >
              <input
                type="checkbox"
                checked={form.emailNotifications}
                onChange={(e) => {
                  setSaved(false);
                  setForm({ ...form, emailNotifications: e.target.checked });
                }}
                style={{ width: '18px', height: '18px', accentColor: '#0f172a', cursor: 'pointer' }}
              />
              <span>Receive email alerts about shift approvals, invitations, and payments</span>
            </label>
          </div>

          {/* Action Buttons */}
          <div className="bento-form-actions">
            <button
              type="submit"
              className="bento-btn bento-btn-primary"
              disabled={m.isPending}
              style={{ background: '#bbf7d0', padding: '0.85rem 2.25rem', fontSize: '1rem' }}
            >
              {m.isPending ? 'Saving...' : '✓ Save Profile Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
