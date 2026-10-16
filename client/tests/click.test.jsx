import { it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const fx = (f) => JSON.parse(fs.readFileSync(`tests/fixtures/${f}.json`, 'utf8'));
const eid = () => fs.readFileSync('tests/fixtures/eid', 'utf8').trim();

vi.mock('../src/api/client.js', () => {
  const get = async (url) => {
    const who = globalThis.__who;
    if (url === '/events') return { data: JSON.parse(fs.readFileSync('tests/fixtures/V_list.json', 'utf8')) };
    if (url === `/events/${fs.readFileSync('tests/fixtures/eid', 'utf8').trim()}`) return { data: JSON.parse(fs.readFileSync(`tests/fixtures/${who}_event.json`, 'utf8')) };
    if (url.endsWith('/shifts') && url.startsWith('/events/')) return { data: JSON.parse(fs.readFileSync(`tests/fixtures/${who}_shifts.json`, 'utf8')) };
    if (url.endsWith('/announcements')) return { data: JSON.parse(fs.readFileSync(`tests/fixtures/${who}_ann.json`, 'utf8')) };
    if (url === '/notifications/unread-count') return { data: { unread: 0 } };
    if (url === '/attendance/lead/shifts') return { data: { shifts: [] } };
    return { data: {} };
  };
  return { default: { get, post: get, put: get, patch: get, delete: get }, setAccessToken() {}, setAuthFailHandler() {}, errorMessage: (e) => e?.message, fieldErrors: () => ({}), downloadFile: async () => {},
    refreshSession: async () => ({ accessToken: 't', user: { _id: 'u', name: 'T User', email: 'e@e', role: globalThis.__role } }) };
});
vi.mock('html5-qrcode', () => ({ Html5Qrcode: class {} }));
import App from '../src/App.jsx';
import { AuthProvider } from '../src/context/AuthContext.jsx';
afterEach(cleanup);

for (const [who, role] of [['V', 'volunteer'], ['O', 'organizer']]) {
  it(`${role}: clicking an event card on the Events page opens the event`, async () => {
    globalThis.__who = who; globalThis.__role = role;
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={['/events']}><AuthProvider><App /></AuthProvider></MemoryRouter></QueryClientProvider>);
    const card = await screen.findByRole('link', { name: /Community Blood Drive/ });
    expect(card.getAttribute('href')).toBe(`/events/${eid()}`);
    fireEvent.click(card);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: /Community Blood Drive/ })).toBeTruthy());
    await screen.findByText(/Crew roles|Shifts/);
    expect(screen.queryByRole('alert')).toBeNull();
    quiet.mockRestore();
  });
}
