import { it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const load = (f) => JSON.parse(fs.readFileSync(`tests/fixtures/${f}.json`, 'utf8'));
let VARIANT = {};

vi.mock('../src/api/client.js', () => {
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const get = async (url) => {
    const eid = fs.readFileSync('tests/fixtures/eid', 'utf8').trim();
    const who = globalThis.__who;
    if (url === `/events/${eid}`) { const d = clone(JSON.parse(fs.readFileSync(`tests/fixtures/${who}_event.json`, 'utf8'))); globalThis.__mutEvent?.(d); return { data: d }; }
    if (url === `/events/${eid}/shifts`) { const d = clone(JSON.parse(fs.readFileSync(`tests/fixtures/${who}_shifts.json`, 'utf8'))); globalThis.__mutShifts?.(d); return { data: d }; }
    if (url === `/events/${eid}/announcements`) { const d = clone(JSON.parse(fs.readFileSync(`tests/fixtures/${who}_ann.json`, 'utf8'))); globalThis.__mutAnn?.(d); return { data: d }; }
    return { data: {} };
  };
  return { default: { get, post: get, put: get, patch: get, delete: get }, setAccessToken() {}, setAuthFailHandler() {}, errorMessage: (e) => e?.message, fieldErrors: () => ({}), downloadFile: async () => {}, refreshSession: async () => ({}) };
});
import EventDetail from '../src/pages/EventDetail.jsx';
import ErrorBoundary from '../src/components/ErrorBoundary.jsx';
afterEach(() => { cleanup(); globalThis.__mutEvent = globalThis.__mutShifts = globalThis.__mutAnn = undefined; });

const variants = {
  'roles undefined': { ev: (d) => { delete d.roles; } },
  'no organization': { ev: (d) => { delete d.organization; delete d.event.organization; } },
  'no venue': { ev: (d) => { delete d.event.venue; } },
  'no description': { ev: (d) => { delete d.event.description; } },
  'roles contain nulls in lead': { ev: (d) => { d.roles = (d.roles || []).map((r) => ({ ...r, leadId: null })); } },
  'shifts payload empty object': { sh: (d) => { for (const k of Object.keys(d)) delete d[k]; } },
  'shift missing fields': { sh: (d) => { d.shifts = d.shifts.map((s) => ({ _id: s._id, roleId: s.roleId })); } },
  'shift with null mySignup & bad dates': { sh: (d) => { d.shifts = d.shifts.map((s) => ({ ...s, start: null, end: undefined })); } },
  'announcements not array': { an: (d) => { d.announcements = null; } },
  'announcement missing message': { an: (d) => { d.announcements = [{ _id: 'a' }]; } },
};

for (const who of ['V', 'O']) for (const [name, v] of Object.entries(variants)) {
  it(`${who}: ${name}`, async () => {
    globalThis.__who = who; globalThis.__mutEvent = v.ev; globalThis.__mutShifts = v.sh; globalThis.__mutAnn = v.an;
    const eid = fs.readFileSync('tests/fixtures/eid', 'utf8').trim();
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={[`/events/${eid}`]}><ErrorBoundary resetKey="k"><Routes><Route path="events/:id" element={<EventDetail />} /></Routes></ErrorBoundary></MemoryRouter></QueryClientProvider>);
    await new Promise((r) => setTimeout(r, 450));
    quiet.mockRestore();
    const alert = screen.queryByRole('alert');
    expect(alert?.textContent || '').toBe('');
    // the page must actually show the event, not just avoid crashing
    expect(screen.queryAllByText(/Community Blood Drive/).length).toBeGreaterThan(0);
  });
}
