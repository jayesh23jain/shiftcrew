import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import Icon from '../components/Icon.jsx';
import '../landing.css';

const MARKS = { 7: '#d3c6f7', 9: '#f48a6a', 14: '#a9e6b9', 19: '#fde98a', 22: '#bfe2f6', 28: '#f9d6e2' };

function Star({ color, size = 28, className = '' }) {
  return (
    <svg className={`lp-star ${className}`} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 1C13 8 16 11 23 12C16 13 13 16 12 23C11 16 8 13 1 12C8 11 11 8 12 1Z" fill={color} stroke="#1f2a44" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

function Logo({ size = 40 }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      <circle cx="33" cy="24" r="15" fill="#4c8df6" stroke="#1f2a44" strokeWidth="2" />
      <path d="M25 18c4-3 9-2 11 2s-3 6-6 7-6 4-5 8c-5-4-6-12 0-17z" fill="#2fb86a" />
      <circle cx="13" cy="26" r="4" fill="#f2b38a" stroke="#1f2a44" strokeWidth="1.5" /><rect x="7" y="31" width="12" height="17" rx="6" fill="#e5484d" stroke="#1f2a44" strokeWidth="1.5" />
      <rect x="9" y="46" width="4" height="13" rx="2" fill="#1f2a44" /><rect x="14" y="46" width="4" height="13" rx="2" fill="#1f2a44" />
      <circle cx="52" cy="26" r="4" fill="#f2b38a" stroke="#1f2a44" strokeWidth="1.5" /><rect x="46" y="31" width="12" height="17" rx="6" fill="#2b4ea8" stroke="#1f2a44" strokeWidth="1.5" />
      <rect x="47" y="46" width="4" height="13" rx="2" fill="#1f2a44" /><rect x="53" y="46" width="4" height="13" rx="2" fill="#1f2a44" />
    </svg>
  );
}

// The looping 3D scene. The video is cropped by CSS to just the megaphone, bubble and sparkle,
// and it stays still for people who prefer reduced motion.
function HeroVideo() {
  const ref = useRef(null);
  const [hasVideo, setHasVideo] = useState(true);
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) ref.current?.pause();
  }, []);
  return hasVideo ? (
    <video
      ref={ref}
      className="lp-vm"
      autoPlay
      muted
      loop
      playsInline
      poster="/landing/hero-poster.jpg"
      aria-hidden="true"
      tabIndex={-1}
      onError={() => setHasVideo(false)}
    >
      <source src="/landing/hero.mp4" type="video/mp4" />
      <img src="/landing/hero-poster.jpg" alt="" className="lp-vm" />
    </video>
  ) : (
    <img src="/landing/hero-poster.jpg" alt="" className="lp-vm" />
  );
}

// A picture of the crew dashboard (sample data), not a live screen.
function Tablet() {
  const days = Array.from({ length: 31 }, (_, i) => i + 1);
  return (
    <div className="lp-tablet" aria-hidden="true">
      <div className="lp-screen">
        <div className="lp-sh">
          <h4>VOLUNTEER &amp; EVENT <small>SHIFTCREW</small></h4>
          <div className="lp-hrs"><span className="lp-av"><Icon name="users" size={18} /></span><span>HOURS:<br /><b>6</b></span><Icon name="sliders" size={20} /></div>
        </div>
        <div className="lp-sb">
          <div>
            <div className="lp-mini">
              <h5>Your calendar &amp; schedule</h5>
              <div className="lp-cal">
                {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <i key={i} className="dow">{d}</i>)}
                {[0, 1, 2, 3].map((k) => <b key={`e${k}`} className="empty" />)}
                {days.map((d) => <b key={d} className={MARKS[d] ? 'on' : ''} style={MARKS[d] ? { background: MARKS[d] } : undefined}>{d}</b>)}
              </div>
            </div>
            <div className="lp-next"><div><small>NEXT UPCOMING EVENT</small><h3>CITY CLEANUP DAY</h3><small>OCT 22</small><br /><span className="lp-vbtn">View event details</span></div><Icon name="megaphone" size={54} /></div>
          </div>
          <div>
            <div className="lp-imp">
              <h5>Impact at a glance</h5>
              <div className="lp-imp-row">
                <div><strong>35</strong><span>Total hours</span></div>
                <div><strong>10</strong><span>Events attended</span></div>
                <div><strong>98</strong><span>Reliability</span></div>
              </div>
            </div>
            <div className="lp-mini" style={{ marginTop: 10 }}>
              <h5>Explore new roles</h5>
              {[['calendar', '#d3c6f7', 'Stage crew', 'Sat 9:00 to 13:00, Rs 150/hr'], ['leaf', '#b2ebc0', 'Community garden', 'Create a welcoming green space'], ['pin', '#fbd3cb', 'Registration desk', 'Welcome and check in guests']].map(([ic, bg, t, d]) => (
                <div key={t} className="lp-role"><span className="ib" style={{ background: bg }}><Icon name={ic} size={15} /></span><div>{t}<em>{d}</em></div></div>
              ))}
            </div>
          </div>
        </div>
        <div className="lp-tab">{[['grid', 'Dashboard'], ['search', 'Explore'], ['calendar', 'My events'], ['star', 'Impact'], ['mail', 'Messages']].map(([ic, l]) => <div key={l}><Icon name={ic} size={18} />{l}</div>)}</div>
      </div>
    </div>
  );
}

const FEATURES = [
  ['calendar', '#d3c6f7', 'Shifts without clashes', "Volunteers can't double-book. Full shifts open a waitlist that fills itself when someone drops out."],
  ['qr', '#b2ebc0', 'QR check-in', 'A pass that refreshes every 45 seconds and works once. Team leads scan people in and out.'],
  ['wallet', '#fde98a', 'Stipends that arrive', 'Fund a wallet, approve hours, release payments. Volunteers get a receipt for every payout.'],
  ['award', '#fbd3cb', 'Hours, badges and certificates', 'Approved hours build badges and a certificate that anyone can verify with a code.'],
];
const STEPS = [
  ['#d3c6f7', 'Plan', 'Create an event, add roles, set shifts and pay.'],
  ['#b2ebc0', 'Sign up', 'Volunteers pick shifts and get confirmed or waitlisted.'],
  ['#fde98a', 'Check in', 'A team lead scans each pass at the start and end.'],
  ['#fbd3cb', 'Get paid', 'Approved hours become stipends, with a receipt.'],
];
const CREW = ['Find events near you', 'Join a shift in one tap', 'See your schedule on a calendar', 'Get paid and download receipts'];
const ORGS = ['Plan roles and shifts', 'Approve requests and scan check-ins', 'Approve hours and release payouts', 'Reports and CSV exports'];

const Checks = ({ items }) => (
  <ul className="lp-checks">{items.map((t) => <li key={t}><i><Icon name="check" size={14} strokeWidth={3} /></i>{t}</li>)}</ul>
);

export default function Landing() {
  const { user, logout } = useAuth();
  const primary = user
    ? <Link className="lp-btn lp-y" to="/dashboard">Go to dashboard<Icon name="check" size={20} /></Link>
    : <Link className="lp-btn lp-y" to="/register">Create an account<Icon name="check" size={20} /></Link>;

  return (
    <div className="lp">
      <div className="lp-shapes" aria-hidden="true"><i className="a" /><i className="b" /><i className="c" /><i className="d" /></div>
      <div className="lp-wrap">
        <nav className="lp-card lp-nav" aria-label="Main">
          <Link to="/" className="lp-brand"><Logo size={42} />ShiftCrew</Link>
          <div className="lp-links">
            <a href="#how">How it works</a>
            <a href="#features">Features</a>
            <a href="#roles">For crew &amp; organizers</a>
            <Link to="/verify">Verify a certificate</Link>
          </div>
          <div className="lp-nr">
            {user ? (
              <>
                <Link className="lp-btn lp-sm lp-y" to="/dashboard">Dashboard</Link>
                <button type="button" className="lp-btn lp-sm lp-ghost" onClick={logout}>Log out</button>
              </>
            ) : (
              <>
                <Link className="lp-btn lp-sm" to="/login">Log in</Link>
                <Link className="lp-btn lp-sm lp-y" to="/register">Sign up</Link>
              </>
            )}
          </div>
        </nav>

        <section className="lp-card lp-herobox">
          <Star color="#fde98a" size={34} className="s1" /><Star color="#d3c6f7" size={26} className="s2" /><Star color="#f9d6e2" size={30} className="s3" />
          <div className="lp-hero">
            <div className="lp-copy">
              <span className="lp-chip"><Icon name="users" size={18} />Volunteer &amp; event management</span>
              <h1>Run your event <mark>crew</mark> without the spreadsheet.</h1>
              <p className="lp-lead">ShiftCrew helps fests, NGOs and hackathons plan roles and shifts, keep volunteers from double-booking, and pay stipends for the hours people actually worked.</p>
              <div className="lp-ctas">{primary}<a className="lp-btn" href="#how">See how it works</a></div>
              <div className="lp-trust">{['QR check-in', 'Stipend payouts', 'Certificates'].map((t) => <span key={t}><i><Icon name="check" size={14} strokeWidth={3} /></i>{t}</span>)}</div>
            </div>
            <div className="lp-stage">
              <div className="lp-vcard"><HeroVideo /></div>
              <Tablet />
              <div className="lp-card lp-float f1"><span className="i" style={{ background: '#fff' }}><Icon name="check" size={18} strokeWidth={3} /></span>Shift confirmed</div>
              <div className="lp-card lp-float f2"><span className="i" style={{ background: '#fff' }}><Icon name="wallet" size={18} /></span>Rs 600 paid to your UPI</div>
              <div className="lp-card lp-float f3"><span className="i q"><Icon name="qr" size={24} /></span><span>QR pass<br /><small>refreshes every 45s</small></span></div>
            </div>
          </div>
        </section>

        <section className="lp-strip">
          {[['check', '#b2ebc0', 'No double-booking', 'Clashing shifts are blocked'], ['clock', '#d3c6f7', 'Waitlist that fills itself', 'Freed spots go to the next person'], ['wallet', '#fbd3cb', 'Every rupee tracked', 'Ledger, receipts, audit log']].map(([ic, bg, t, d]) => (
            <div key={t} className="lp-card lp-pt"><span className="lp-ib" style={{ background: bg }}><Icon name={ic} size={26} strokeWidth={ic === 'check' ? 3 : 2} /></span><div>{t}<small>{d}</small></div></div>
          ))}
        </section>

        <section id="features" className="lp-sec"><h2>Everything an event crew needs</h2><p>From the first shift to the final certificate, in one place.</p></section>
        <section className="lp-feat">
          {FEATURES.map(([ic, bg, t, d]) => (
            <div key={t} className="lp-card" style={{ background: bg }}><span className="lp-ib" style={{ background: '#fff' }}><Icon name={ic} size={28} /></span><h3>{t}</h3><p>{d}</p></div>
          ))}
        </section>

        <section id="how" className="lp-sec"><h2>From plan to payout in four steps</h2></section>
        <ol className="lp-steps">
          {STEPS.map(([bg, t, d], i) => (
            <li key={t}><div className="n" style={{ background: bg }}>{i + 1}</div><h3>{t}</h3><p>{d}</p></li>
          ))}
        </ol>

        <section id="roles" className="lp-roles">
          <div className="lp-card" style={{ background: '#d3c6f7' }}><h3>For crew</h3><Checks items={CREW} /><Link className="lp-btn lp-y" to={user ? '/events' : '/register'}>Join as crew</Link></div>
          <div className="lp-card" style={{ background: '#a6e7d6' }}><h3>For organizers</h3><Checks items={ORGS} /><Link className="lp-btn lp-y" to={user ? '/dashboard' : '/register'}>Organize an event</Link></div>
        </section>

        {!user && (
          <section className="lp-card lp-cta">
            <div><h2>Your next event runs better with a crew you can count on.</h2><p>Set up your first event in a few minutes.</p>
              <div className="lp-ctas"><Link className="lp-btn" to="/register">Create an account</Link><Link className="lp-btn lp-ghost" to="/login">Log in</Link></div></div>
            <Icon name="megaphone" size={170} strokeWidth={1.6} className="lp-mega" />
          </section>
        )}

        {!user && (
          <footer className="lp-footer">
            <Link to="/" className="lp-brand sm"><Logo size={34} />ShiftCrew</Link>
            <div className="lp-fl"><a href="#how">How it works</a><a href="#roles">For crew</a><Link to="/verify">Verify a certificate</Link></div>
            <span>A portfolio project. Payments run in sandbox mode only.</span>
          </footer>
        )}
      </div>
    </div>
  );
}
