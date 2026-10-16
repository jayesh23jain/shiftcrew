import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

let ROLE = null; // null = logged out
const iso = new Date(Date.now() + 5 * 86400000).toISOString();
const event = (canManage) => ({ _id: 'e1', orgId: 'o1', title: 'Test Fest', description: 'A description that is long enough.', category: 'college_fest', venue: { city: 'Pune' }, startDate: iso, endDate: iso, status: 'draft', visibility: 'public', applicationMode: 'open', ...(canManage ? { inviteCode: 'x' } : {}) });

const respond = (url) => {
  const staff = ROLE && ROLE !== 'volunteer';
  const table = [
    [/^\/events$/, { events: [event()], page: 1, pages: 1, total: 1 }],
    [/^\/events\/mine$/, { events: [event(true)] }],
    [/^\/events\/e1$/, { event: event(staff), roles: [], canManage: !!staff, organization: { name: 'Org' } }],
    [/^\/events\/e1\/shifts$/, { shifts: [] }],
    [/^\/events\/e1\/announcements$/, { announcements: [] }],
    [/^\/events\/e1\/report$/, { totals: { fillRate: 0, confirmed: 0, capacity: 0, noShowRate: 0, volunteers: 0, shifts: 0, approvedMinutes: 0 }, money: { budgetAtCapacity: 0, approved: 0, paid: 0, fees: 0 }, perShift: [], perRole: [], topVolunteers: [] }],
    [/^\/events\/e1\/disputes$/, { disputes: [] }],
    [/^\/events\/e1\/audit$/, { logs: [] }],
    [/^\/orgs\/mine$/, { orgs: [{ _id: 'o1', name: 'Org' }] }],
    [/^\/me\/shifts$/, { signups: [] }],
    [/^\/me\/stats$/, { minutes: 0, shifts: 0, events: 0, attendanceRate: 0, reliability: 100, earned: 0, byMonth: [], badges: [] }],
    [/^\/notifications$/, { notifications: [], unread: 0 }],
    [/^\/notifications\/unread-count$/, { unread: 0 }],
    [/^\/attendance\/lead\/shifts$/, { shifts: [] }],
    [/^\/attendance\/events\/e1$/, { records: [] }],
    [/^\/attendance\/pass\/s1$/, { token: 'x'.repeat(40), expiresAt: new Date(Date.now() + 60000).toISOString(), attendance: null }],
    [/^\/attendance\/shifts\/s1\/sheet$/, { shift: { start: iso, end: iso }, roster: [] }],
    [/^\/payouts\/mine$/, { totals: { paid: 0, pending: 0, processing: 0 }, payouts: [], pending: [] }],
    [/^\/payouts\/method$/, { method: null }],
    [/^\/payouts\/events\/e1$/, { payables: [], payouts: [] }],
    [/^\/certificates\/mine$/, { certificates: [] }],
    [/^\/wallet\/orgs\/o1$/, { wallet: { available: 0, totalFunded: 0, totalPaidOut: 0 }, ledger: [], provider: 'mock', feePercent: 2, committed: { total: 0, byEvent: [] } }],
    [/^\/admin\/stats$/, { users: 1, orgs: 1, events: 1, openDisputes: 0, payouts: { count: 0, paidAmount: 0, fees: 0, failureRate: 0 }, walletBalance: 0 }],
  ];
  for (const [re, data] of table) if (re.test(url)) return { data };
  return { data: {} };
};

vi.mock('../src/api/client.js', () => {
  const api = { get: async (u) => respond(u), post: async (u) => respond(u), put: async (u) => respond(u), patch: async (u) => respond(u), delete: async (u) => respond(u) };
  return {
    default: api,
    setAccessToken: () => {}, setAuthFailHandler: () => {},
    refreshSession: async () => { if (!ROLE) throw new Error('no session'); return { accessToken: 't', user: { _id: 'u1', name: 'Test User', email: 't@t.dev', role: ROLE, city: 'Pune', phone: '1', skills: ['a'] } }; },
    errorMessage: (e) => e?.message || 'error', fieldErrors: () => ({}), downloadFile: async () => {},
  };
});
vi.mock('html5-qrcode', () => ({ Html5Qrcode: class { start() {} stop() { return Promise.resolve(); } clear() {} } }));

import App from '../src/App.jsx';
import { AuthProvider } from '../src/context/AuthContext.jsx';

let lastPath = '';
const Spy = () => { lastPath = useLocation().pathname + useLocation().search; return null; };

async function visit(path) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider><Spy /><App /></AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}
afterEach(() => { cleanup(); });

// [role, path, expected text on the page, expected final path (optional)]
const cases = [
  [null, '/', /Run your event crew/],
  [null, '/events', /Log in/, '/login'],
  [null, '/events/e1', /Log in/, '/login'],
  [null, '/dashboard', /Log in/, '/login'],
  [null, '/my-shifts', /Log in/, '/login'],
  [null, '/manage/events/new', /Log in/, '/login'],
  [null, '/verify', /Verify a certificate/],
  [null, '/verify/SC-AAAA-BBBB', /Verify a certificate/],
  [null, '/register', /Create your account/],
  [null, '/nope/nothing', /Run your event crew/, '/'],

  ['volunteer', '/', /Go to dashboard/],
  ['volunteer', '/login', /Hi Test/, '/dashboard'],
  ['volunteer', '/dashboard', /Hi Test/],
  ['volunteer', '/events', /Events looking for crew/],
  ['volunteer', '/events/e1', /Test Fest/],
  ['volunteer', '/my-shifts', /My shifts/],
  ['volunteer', '/earnings', /Earnings/],
  ['volunteer', '/certificates', /Certificates/],
  ['volunteer', '/notifications', /Notifications/],
  ['volunteer', '/profile', /Your profile/],
  ['volunteer', '/pass/s1', /Your pass/],
  ['volunteer', '/checkin', /Check-in desk/],
  ['volunteer', '/checkin/s1', /Scan volunteers/],
  ['volunteer', '/manage/events/new', /Hi Test/, '/dashboard'],
  ['volunteer', '/manage/events/e1', /Hi Test/, '/dashboard'],
  ['volunteer', '/admin', /Hi Test/, '/dashboard'],

  ['organizer', '/dashboard', /Your events/],
  ['organizer', '/events/e1', /Manage this event/],
  ['organizer', '/manage/events/new', /Create event/],
  ['organizer', '/manage/events/e1', /Crew roles/],
  ['organizer', '/manage/events/e1/edit', /Edit event/],
  ['organizer', '/manage/events/e1?tab=shifts', /Add a role first|Add a shift/],
  ['organizer', '/manage/events/e1?tab=hours', /No attendance yet/],
  ['organizer', '/manage/events/e1?tab=funds', /Wallet balance/],
  ['organizer', '/manage/events/e1?tab=comms', /Announcements/],
  ['organizer', '/checkin', /Check-in desk/],
  ['organizer', '/admin', /Your events/, '/dashboard'],

  ['admin', '/admin', /Platform admin/],
  ['admin', '/dashboard', /Your events/],
];

describe('routing', () => {
  for (const [role, path, text, finalPath] of cases) {
    it(`${role || 'logged out'} ${path}`, async () => {
      ROLE = role;
      await visit(path);
      await waitFor(() => expect(screen.getAllByText(text).length).toBeGreaterThan(0), { timeout: 3000 });
      if (finalPath) expect(lastPath).toBe(finalPath);
    });
  }
});

import ErrorBoundary from '../src/components/ErrorBoundary.jsx';

describe('error boundary', () => {
  const Boom = () => { throw new Error('kaboom'); };

  it('shows a message instead of a blank screen when a page crashes, and recovers on navigation', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { rerender } = render(<MemoryRouter><ErrorBoundary resetKey="/a"><Boom /></ErrorBoundary></MemoryRouter>);
    expect(screen.getByRole('alert').textContent).toMatch(/ran into a problem/);
    expect(screen.getByRole('alert').textContent).toMatch(/kaboom/);
    // a different URL resets the boundary, so the next page renders normally
    rerender(<MemoryRouter><ErrorBoundary resetKey="/b"><p>fine now</p></ErrorBoundary></MemoryRouter>);
    expect(screen.getByText('fine now')).toBeTruthy();
    quiet.mockRestore();
  });
});
