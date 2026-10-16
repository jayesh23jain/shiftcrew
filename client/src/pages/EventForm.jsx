import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api, { errorMessage, fieldErrors } from '../api/client.js';
import { CATEGORIES, endOfDayISO, startOfDayISO, toInputDate } from '../lib.js';
import { Field, Notice, Spinner } from '../components/ui.jsx';

const blank = {
  orgId: '', title: '', description: '', category: 'college_fest',
  venueName: '', address: '', city: '', startDate: '', endDate: '',
  visibility: 'public', applicationMode: 'open', bannerUrl: '',
};

export default function EventForm() {
  const { id } = useParams();
  const editing = !!id;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState(blank);
  const [clientError, setClientError] = useState('');

  const { data: orgs } = useQuery({ queryKey: ['orgs', 'mine'], queryFn: async () => (await api.get('/orgs/mine')).data });
  const { data: existing, isLoading } = useQuery({
    queryKey: ['event', id],
    queryFn: async () => (await api.get(`/events/${id}`)).data,
    enabled: editing,
  });

  useEffect(() => {
    if (existing) {
      const e = existing.event;
      setForm({
        orgId: e.orgId, title: e.title, description: e.description || '', category: e.category,
        venueName: e.venue?.name || '', address: e.venue?.address || '', city: e.venue?.city || '',
        startDate: toInputDate(e.startDate), endDate: toInputDate(e.endDate),
        visibility: e.visibility, applicationMode: e.applicationMode, bannerUrl: e.bannerUrl || '',
      });
    } else if (orgs?.orgs?.length && !form.orgId) {
      setForm((f) => ({ ...f, orgId: orgs.orgs[0]._id }));
    }
  }, [existing, orgs]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        title: form.title,
        description: form.description,
        category: form.category,
        bannerUrl: form.bannerUrl,
        venue: { name: form.venueName, address: form.address, city: form.city },
        startDate: form.startDate ? startOfDayISO(form.startDate) : undefined,
        endDate: form.endDate ? endOfDayISO(form.endDate) : undefined,
        visibility: form.visibility,
        applicationMode: form.applicationMode,
      };
      return editing
        ? (await api.patch(`/events/${id}`, payload)).data
        : (await api.post('/events', { ...payload, orgId: form.orgId })).data;
    },
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ['events'] });
      qc.invalidateQueries({ queryKey: ['event'] });
      navigate(`/manage/events/${d.event._id}`);
    },
  });

  if (editing && isLoading) return <Spinner />;
  if (orgs && !orgs.orgs.length) return <Notice tone="info">Create an organization from your dashboard before adding events.</Notice>;

  const errors = save.error ? fieldErrors(save.error) : {};
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="bento-form-wrapper">
      {/* Neo-Brutalist Header Banner */}
      <div className="bento-form-hero">
        <div className="bento-form-hero-left">
          <span className="bento-form-tag">
            {editing ? '⚡ EDITING EVENT' : '✨ EVENT CREATOR'}
          </span>
          <h1 className="bento-form-title">{editing ? 'Edit Event' : 'Create Event'}</h1>
          <p className="bento-form-subtitle">
            {editing
              ? 'Changes save to the event right away.'
              : 'Start with the basics. You can add roles and publish shifts afterwards.'}
          </p>
        </div>
        <Link to="/events" className="bento-btn bento-btn-secondary">
          ← Back to Events
        </Link>
      </div>

      {/* Main Neo-Brutalist Form Card */}
      <div className="bento-form-card">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setClientError('');
            if (!form.venueName?.trim() || !form.city?.trim() || !form.address?.trim()) {
              setClientError('📍 Event location is mandatory: Please enter Venue Name, City, and Full Address so volunteers can calculate distance and navigate via Google Maps.');
              window.scrollTo({ top: 300, behavior: 'smooth' });
              return;
            }
            save.mutate();
          }}
          noValidate
        >
          <Notice>{(clientError || (save.error && errorMessage(save.error))) && (clientError || errorMessage(save.error))}</Notice>

          {/* Section 1: Basic Details */}
          <div className="bento-form-section">
            <div className="bento-section-header">
              <span className="bento-section-badge badge-yellow">1</span>
              <h3 className="bento-section-title">Event Identity & Category</h3>
            </div>

            {!editing && orgs?.orgs?.length > 1 && (
              <Field label="Hosting Organization">
                <select value={form.orgId} onChange={set('orgId')}>
                  {orgs.orgs.map((o) => (
                    <option key={o._id} value={o._id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            <Field label="Event Title" error={errors.title}>
              <input
                value={form.title}
                onChange={set('title')}
                placeholder="e.g. Annual Tech Symposium 2026"
                required
              />
            </Field>

            <Field label="Category">
              <select value={form.category} onChange={set('category')}>
                {Object.entries(CATEGORIES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>

            <Field
              label="Description"
              error={errors.description}
              hint="Shown to volunteers. At least 20 characters required to publish."
            >
              <textarea
                rows={4}
                value={form.description}
                onChange={set('description')}
                placeholder="Describe the event, mission, and what kind of crew you are looking for..."
              />
            </Field>
          </div>

          {/* Section 2: Date & Time */}
          <div className="bento-form-section">
            <div className="bento-section-header">
              <span className="bento-section-badge badge-mint">2</span>
              <h3 className="bento-section-title">Date & Schedule</h3>
            </div>

            <div className="two">
              <Field label="Starts On" error={errors.startDate}>
                <input
                  type="date"
                  value={form.startDate}
                  onChange={set('startDate')}
                  required
                />
              </Field>
              <Field label="Ends On" error={errors.endDate}>
                <input
                  type="date"
                  value={form.endDate}
                  onChange={set('endDate')}
                  required
                />
              </Field>
            </div>
          </div>

          {/* Section 3: Venue & Location */}
          <div className="bento-form-section">
            <div className="bento-section-header">
              <span className="bento-section-badge badge-lavender">3</span>
              <h3 className="bento-section-title">Venue & Location</h3>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.82rem', color: '#475569', fontWeight: 700 }}>
                📍 Mandatory: Full location is required so crew volunteers can view distance and get turn-by-turn Google Maps directions.
              </span>
              {(form.venueName || form.address || form.city) && (
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([form.venueName, form.address, form.city].filter(Boolean).join(', '))}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-white"
                  style={{ fontSize: '0.76rem', padding: '0.3rem 0.75rem', fontWeight: 800, border: '1.5px solid #0f172a' }}
                >
                  🗺️ Test Pin on Google Maps ↗
                </a>
              )}
            </div>

            <div className="two">
              <Field label="Venue Name *" error={errors['venue.name']}>
                <input
                  value={form.venueName}
                  onChange={set('venueName')}
                  placeholder="e.g. Grand Convention Center"
                  required
                />
              </Field>
              <Field label="City *" error={errors['venue.city']}>
                <input
                  value={form.city}
                  onChange={set('city')}
                  placeholder="e.g. Mumbai, Delhi, Bengaluru"
                  required
                />
              </Field>
            </div>

            <Field label="Full Address / Directions *" error={errors['venue.address']} hint="Street, Gate, Landmark, or Campus building">
              <input
                value={form.address}
                onChange={set('address')}
                placeholder="e.g. Hall 4, Gate B, Science City Campus, Ring Road"
                required
              />
            </Field>
          </div>

          {/* Section 4: Visibility & Joining Shifts */}
          <div className="bento-form-section">
            <div className="bento-section-header">
              <span className="bento-section-badge badge-sky">4</span>
              <h3 className="bento-section-title">Visibility, Joining & Media</h3>
            </div>

            <div className="two">
              <Field label="Who can see it">
                <select value={form.visibility} onChange={set('visibility')}>
                  <option value="public">Public — listed on discover page for everyone</option>
                  <option value="invite_only">Invite Only — volunteers join with private link</option>
                </select>
              </Field>
              <Field label="Shift Joining Mode">
                <select value={form.applicationMode} onChange={set('applicationMode')}>
                  <option value="open">Instant Join — volunteers claim spots immediately</option>
                  <option value="approval">Approval Needed — you review each application</option>
                </select>
              </Field>
            </div>

            <Field
              label="Banner Image URL"
              error={errors.bannerUrl}
              hint="Optional. Provide a direct link to an image banner (JPG, PNG, WebP)"
            >
              <input
                value={form.bannerUrl}
                onChange={set('bannerUrl')}
                placeholder="https://images.unsplash.com/..."
              />
            </Field>
          </div>

          {/* Bottom Action Buttons */}
          <div className="bento-form-actions">
            <Link to="/events" className="bento-btn bento-btn-secondary">
              Cancel
            </Link>
            <button
              type="submit"
              className="bento-btn bento-btn-primary"
              disabled={save.isPending}
            >
              {save.isPending
                ? 'Saving...'
                : editing
                ? '✓ Save Changes'
                : '✓ Create Event Draft'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
