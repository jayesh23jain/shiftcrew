import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { errorMessage, fieldErrors } from '../api/client.js';
import Icon from '../components/Icon.jsx';
import '../landing.css';

function Star({ color, size = 28, className = '', style = {} }) {
  return (
    <svg className={`lp-star ${className}`} style={style} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 1C13 8 16 11 23 12C16 13 13 16 12 23C11 16 8 13 1 12C8 11 11 8 12 1Z"
        fill={color}
        stroke="#1f2a44"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Logo({ size = 36 }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      <circle cx="33" cy="24" r="15" fill="#4c8df6" stroke="#1f2a44" strokeWidth="2" />
      <path d="M25 18c4-3 9-2 11 2s-3 6-6 7-6 4-5 8c-5-4-6-12 0-17z" fill="#2fb86a" />
      <circle cx="13" cy="26" r="4" fill="#f2b38a" stroke="#1f2a44" strokeWidth="1.5" />
      <rect x="7" y="31" width="12" height="17" rx="6" fill="#e5484d" stroke="#1f2a44" strokeWidth="1.5" />
      <rect x="9" y="46" width="4" height="13" rx="2" fill="#1f2a44" />
      <rect x="14" y="46" width="4" height="13" rx="2" fill="#1f2a44" />
      <circle cx="52" cy="26" r="4" fill="#f2b38a" stroke="#1f2a44" strokeWidth="1.5" />
      <rect x="46" y="31" width="12" height="17" rx="6" fill="#2b4ea8" stroke="#1f2a44" strokeWidth="1.5" />
      <rect x="47" y="46" width="4" height="13" rx="2" fill="#1f2a44" />
      <rect x="53" y="46" width="4" height="13" rx="2" fill="#1f2a44" />
    </svg>
  );
}

function useSubmit(action, onDone) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState({});
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setErrors({});
    try {
      await action();
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      setErrors(fieldErrors(err));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, errors, submit };
}

// Reusable Left Visual Showcase inspired by Landing Hero
function AuthShowcase({ badgeText = 'Crew & Event Portal', quote, chip1 = 'Shift confirmed' }) {
  return (
    <div className="lp-auth-visual">
      <Star color="#fde98a" size={26} className="s1" style={{ top: 12, right: 18 }} />
      <Star color="#f9d6e2" size={22} className="s2" style={{ bottom: 70, left: 14 }} />

      <div className="lp-auth-visual-top">
        <Link to="/" className="lp-brand sm" title="ShiftCrew Home">
          <Logo size={34} />
          ShiftCrew
        </Link>
        <span className="lp-auth-tag-pill">
          <Icon name="check" size={12} strokeWidth={3} />
          {badgeText}
        </span>
      </div>

      <div className="lp-auth-stage">
        {/* Floating Top Badge */}
        {chip1 && (
          <div className="lp-auth-chip c-shift">
            <span style={{ width: 14, height: 14, borderRadius: '50%', background: '#fff', border: '1.5px solid #1f2a44', display: 'grid', placeItems: 'center', fontSize: '9px', fontWeight: 900 }}>✓</span>
            {chip1}
          </div>
        )}

        {/* Mini Tablet Roster Mockup */}
        <div className="lp-auth-mockup">
          <div className="lp-auth-mockup-header">
            <span>VOLUNTEER &amp; EVENT</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '11px' }}>
              <Icon name="users" size={14} />
              <span>HOURS: <b>6</b></span>
            </div>
          </div>

          <div className="lp-auth-mockup-grid">
            <div className="lp-auth-mockup-cal">
              <div className="lp-auth-mockup-cal-title">October 2026</div>
              <div className="lp-auth-cal-grid">
                {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <span key={i} style={{ color: '#64748b' }}>{d}</span>)}
                {[0, 1, 2, 3].map((k) => <span key={`e${k}`} />)}
                {[...Array(28)].map((_, i) => {
                  const d = i + 1;
                  const bg = d === 15 ? '#b2ebc0' : d === 16 ? '#fde98a' : d === 17 ? '#d3c6f7' : undefined;
                  return (
                    <span key={d} className={bg ? 'on' : ''} style={bg ? { background: bg } : undefined}>
                      {d}
                    </span>
                  );
                })}
              </div>
            </div>

            <div className="lp-auth-kpi-stack">
              <div className="lp-auth-kpi-tile" style={{ background: '#d3c6f7' }}>
                <span>Hours</span>
                <strong>35</strong>
              </div>
              <div className="lp-auth-kpi-tile" style={{ background: '#b2ebc0' }}>
                <span>Events</span>
                <strong>10</strong>
              </div>
              <div className="lp-auth-kpi-tile" style={{ background: '#fde98a' }}>
                <span>Reliability</span>
                <strong>98%</strong>
              </div>
            </div>
          </div>

          <div className="lp-auth-event-banner">
            <div>
              <small style={{ fontSize: '9px', fontWeight: 800, textTransform: 'uppercase', opacity: 0.75 }}>Next Upcoming Event</small>
              <h4 style={{ margin: 0, fontSize: '13.5px', fontFamily: "'Baloo 2', sans-serif" }}>CITY CLEANUP DAY</h4>
            </div>
            <Icon name="megaphone" size={24} />
          </div>
        </div>
      </div>

      <div className="lp-auth-visual-footer">
        <div className="lp-auth-visual-quote">
          {quote}
        </div>
      </div>
    </div>
  );
}

export function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const dest = location.state?.from || '/dashboard';
  const { busy, error, errors, submit } = useSubmit(() => login(form), () => navigate(dest, { replace: true }));

  if (user) return <Navigate to={dest} replace />;

  return (
    <div className="lp lp-auth-viewport">
      {/* Background Shapes & Ambient Stars */}
      <div className="lp-shapes" aria-hidden="true">
        <i className="a" />
        <i className="b" />
        <i className="c" />
        <i className="d" />
      </div>

      <Star color="#fde98a" size={32} className="s1" style={{ top: 70, left: '10%' }} />
      <Star color="#d3c6f7" size={26} className="s2" style={{ top: 160, right: '8%' }} />
      <Star color="#f9d6e2" size={28} className="s3" style={{ bottom: 100, left: '6%' }} />

      {/* Main Split-Screen Container */}
      <main className="lp-auth-container">
        <div className="lp-split-auth-card">
          {/* Left Side: Visual Showcase matching Landing Page Hero */}
          <AuthShowcase
            badgeText="Volunteer &amp; Event"
            chip1="Shift confirmed"
            quote="“Run your event crew without the spreadsheet. Instant QR check-in & stipends that arrive.”"
          />

          {/* Right Side: Form */}
          <div className="lp-auth-form-side">
            <div className="lp-auth-header">
              <div className="lp-auth-badge">
                <Icon name="check" size={13} strokeWidth={3} />
                <span>Welcome Back</span>
              </div>
              <h1 style={{ fontSize: '28px', margin: '0 0 4px' }}>Log in to ShiftCrew</h1>
              <p style={{ fontSize: '13.5px', margin: 0 }}>Access your live roster, shifts, and earnings ledger.</p>
            </div>

            <form onSubmit={submit} noValidate className="lp-auth-form">
              {error && (
                <div className="lp-alert-err" role="alert">
                  <span style={{ fontSize: '16px' }}>⚠️</span>
                  <span>{error}</span>
                </div>
              )}

              <div className="lp-field">
                <label className="lp-field-label" htmlFor="login-email">
                  <span>Email address</span>
                  {errors.email && <span className="lp-field-err">{errors.email}</span>}
                </label>
                <div className="lp-input-wrap">
                  <span className="lp-input-icon">
                    <Icon name="mail" size={17} />
                  </span>
                  <input
                    id="login-email"
                    type="email"
                    autoComplete="email"
                    placeholder="name@example.com"
                    className={`lp-input ${errors.email ? 'has-error' : ''}`}
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    required
                  />
                </div>
              </div>

              <div className="lp-field">
                <label className="lp-field-label" htmlFor="login-password">
                  <span>Password</span>
                  {errors.password && <span className="lp-field-err">{errors.password}</span>}
                </label>
                <div className="lp-input-wrap">
                  <span className="lp-input-icon">
                    <Icon name="sliders" size={17} />
                  </span>
                  <input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    className={`lp-input ${errors.password ? 'has-error' : ''}`}
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    style={{
                      position: 'absolute',
                      right: 12,
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: '11px',
                      fontWeight: 800,
                      color: '#53607a',
                      padding: '4px',
                    }}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? 'HIDE' : 'SHOW'}
                  </button>
                </div>
              </div>

              <button type="submit" className="lp-btn lp-y lp-auth-submit" disabled={busy}>
                {busy ? (
                  <>Logging in...</>
                ) : (
                  <>
                    Log in to Dashboard
                    <Icon name="check" size={18} strokeWidth={2.5} />
                  </>
                )}
              </button>
            </form>

            <div className="lp-auth-footer" style={{ marginTop: '16px', fontSize: '13.5px' }}>
              New here? <Link to="/register">Create a free account</Link>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export function Register() {
  const { user, register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'volunteer' });
  const [showPassword, setShowPassword] = useState(false);
  const { busy, error, errors, submit } = useSubmit(() => register(form), () => navigate('/dashboard', { replace: true }));

  if (user) return <Navigate to="/dashboard" replace />;
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="lp lp-auth-viewport">
      {/* Background Shapes & Ambient Stars */}
      <div className="lp-shapes" aria-hidden="true">
        <i className="a" />
        <i className="b" />
        <i className="c" />
        <i className="d" />
      </div>

      <Star color="#fde98a" size={32} className="s1" style={{ top: 70, right: '10%' }} />
      <Star color="#d3c6f7" size={26} className="s2" style={{ top: 200, left: '8%' }} />
      <Star color="#b2ebc0" size={30} className="s3" style={{ bottom: 90, right: '6%' }} />

      {/* Main Split-Screen Container */}
      <main className="lp-auth-container">
        <div className="lp-split-auth-card">
          {/* Left Side: Visual Showcase matching Landing Page Hero */}
          <AuthShowcase
            badgeText="Get Started in 30s"
            chip1="No double-booking"
            quote="“Whether you are picking up shifts or running 100+ volunteers, set up in under a minute.”"
          />

          {/* Right Side: Form */}
          <div className="lp-auth-form-side">
            <div className="lp-auth-header" style={{ marginBottom: '10px' }}>
              <div className="lp-auth-badge" style={{ marginBottom: '4px' }}>
                <Icon name="star" size={12} />
                <span>Create Free Account</span>
              </div>
              <h1 style={{ fontSize: '26px', margin: '0 0 3px' }}>Join ShiftCrew</h1>
              <p style={{ fontSize: '13px', margin: 0 }}>Pick your role to get custom event tools.</p>
            </div>

            <form onSubmit={submit} noValidate className="lp-auth-form" style={{ gap: '9px' }}>
              {error && (
                <div className="lp-alert-err" role="alert">
                  <span style={{ fontSize: '16px' }}>⚠️</span>
                  <span>{error}</span>
                </div>
              )}

              {/* Role Choice Cards */}
              <div className="lp-field" style={{ gap: '3px' }}>
                <span className="lp-field-label">I want to</span>
                <div className="lp-choice-grid">
                  <div
                    className={`lp-choice-card ${form.role === 'volunteer' ? 'selected-volunteer' : ''}`}
                    onClick={() => setForm({ ...form, role: 'volunteer' })}
                    role="radio"
                    aria-checked={form.role === 'volunteer'}
                    tabIndex={0}
                    onKeyDown={(e) => e.key === ' ' && setForm({ ...form, role: 'volunteer' })}
                  >
                    <div className="lp-choice-header">
                      <span className="lp-choice-icon">
                        <Icon name="users" size={16} />
                      </span>
                      <span className={`lp-choice-radio ${form.role === 'volunteer' ? 'checked' : ''}`} />
                    </div>
                    <h3 className="lp-choice-title">Join as crew</h3>
                    <p className="lp-choice-desc">Find shifts, get QR pass &amp; stipends.</p>
                  </div>

                  <div
                    className={`lp-choice-card ${form.role === 'organizer' ? 'selected-organizer' : ''}`}
                    onClick={() => setForm({ ...form, role: 'organizer' })}
                    role="radio"
                    aria-checked={form.role === 'organizer'}
                    tabIndex={0}
                    onKeyDown={(e) => e.key === ' ' && setForm({ ...form, role: 'organizer' })}
                  >
                    <div className="lp-choice-header">
                      <span className="lp-choice-icon">
                        <Icon name="megaphone" size={16} />
                      </span>
                      <span className={`lp-choice-radio ${form.role === 'organizer' ? 'checked' : ''}`} />
                    </div>
                    <h3 className="lp-choice-title">Organize event</h3>
                    <p className="lp-choice-desc">Plan roles, shifts &amp; scan passes.</p>
                  </div>
                </div>
              </div>

              <div className="lp-field">
                <label className="lp-field-label" htmlFor="reg-name">
                  <span>Full name</span>
                  {errors.name && <span className="lp-field-err">{errors.name}</span>}
                </label>
                <div className="lp-input-wrap">
                  <span className="lp-input-icon">
                    <Icon name="users" size={16} />
                  </span>
                  <input
                    id="reg-name"
                    type="text"
                    autoComplete="name"
                    placeholder="e.g. Alex Johnson"
                    className={`lp-input ${errors.name ? 'has-error' : ''}`}
                    value={form.name}
                    onChange={set('name')}
                    required
                  />
                </div>
              </div>

              <div className="lp-field">
                <label className="lp-field-label" htmlFor="reg-email">
                  <span>Email address</span>
                  {errors.email && <span className="lp-field-err">{errors.email}</span>}
                </label>
                <div className="lp-input-wrap">
                  <span className="lp-input-icon">
                    <Icon name="mail" size={16} />
                  </span>
                  <input
                    id="reg-email"
                    type="email"
                    autoComplete="email"
                    placeholder="name@example.com"
                    className={`lp-input ${errors.email ? 'has-error' : ''}`}
                    value={form.email}
                    onChange={set('email')}
                    required
                  />
                </div>
              </div>

              <div className="lp-field">
                <label className="lp-field-label" htmlFor="reg-password">
                  <span>Password</span>
                  {errors.password && <span className="lp-field-err">{errors.password}</span>}
                </label>
                <div className="lp-input-wrap">
                  <span className="lp-input-icon">
                    <Icon name="sliders" size={16} />
                  </span>
                  <input
                    id="reg-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    placeholder="At least 8 characters"
                    className={`lp-input ${errors.password ? 'has-error' : ''}`}
                    value={form.password}
                    onChange={set('password')}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    style={{
                      position: 'absolute',
                      right: 12,
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: '11px',
                      fontWeight: 800,
                      color: '#53607a',
                      padding: '4px',
                    }}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? 'HIDE' : 'SHOW'}
                  </button>
                </div>
              </div>

              <button type="submit" className="lp-btn lp-y lp-auth-submit" disabled={busy}>
                {busy ? (
                  <>Creating account...</>
                ) : (
                  <>
                    Create {form.role === 'organizer' ? 'Organizer' : 'Crew'} Account
                    <Icon name="check" size={18} strokeWidth={2.5} />
                  </>
                )}
              </button>
            </form>

            <div className="lp-auth-footer" style={{ marginTop: '10px', fontSize: '13px' }}>
              Already registered? <Link to="/login">Log in here</Link>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
