import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const dir = 'tests/fixtures';
const load = (f) => JSON.parse(fs.readFileSync(`${dir}/${f}.json`, 'utf8'));
let WHO = 'V';

vi.mock('../src/api/client.js', () => {
  const get = async (url) => {
    const eid = fs.readFileSync('tests/fixtures/eid', 'utf8').trim();
    if (url === `/events/${eid}`) return { data: load(`${WHO}_event`) };
    if (url === `/events/${eid}/shifts`) return { data: load(`${WHO}_shifts`) };
    if (url === `/events/${eid}/announcements`) return { data: load(`${WHO}_ann`) };
    if (url === '/events') return { data: load('V_list') };
    return { data: { unread: 0, shifts: [] } };
  };
  return { default: { get, post: async () => ({ data: {} }), put: get, patch: get, delete: get },
    setAccessToken() {}, setAuthFailHandler() {}, errorMessage: (e) => e?.message, fieldErrors: () => ({}), downloadFile: async () => {},
    refreshSession: async () => ({ accessToken: 't', user: { _id: 'u', name: 'T', role: globalThis.__role, email: 'e@e' } }) };
});

import EventDetail from '../src/pages/EventDetail.jsx';
import ErrorBoundary from '../src/components/ErrorBoundary.jsx';
import { Routes, Route } from 'react-router-dom';

afterEach(cleanup);

for (const who of ['V', 'O']) {
  it(`renders the real event page for ${who === 'V' ? 'volunteer' : 'organizer'}`, async () => {
    WHO = who;
    const eid = fs.readFileSync('tests/fixtures/eid', 'utf8').trim();
    const errors = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...a) => errors.push(a.map(String).join(' ').slice(0, 400)));
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={[`/events/${eid}`]}>
          <ErrorBoundary resetKey="x"><Routes><Route path="events/:id" element={<EventDetail />} /></Routes></ErrorBoundary>
        </MemoryRouter>
      </QueryClientProvider>
    );
    await waitFor(() => expect(screen.queryAllByText(/Community Blood Drive|ran into a problem/).length).toBeGreaterThan(0), { timeout: 3000 });
    await new Promise((r) => setTimeout(r, 300));
    spy.mockRestore();
    const alert = screen.queryByRole('alert');
    console.log(who, 'ALERT:', alert?.textContent?.slice(0, 300), '\nERRORS:', errors.slice(0, 3));
    expect(alert).toBeNull();
  });
}
