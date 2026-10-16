import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api, { errorMessage } from '../api/client.js';
import { formatDateTime, rupees } from '../lib.js';
import { Empty, Notice, Pill, Spinner, Stat, Tabs } from '../components/ui.jsx';

export default function Admin() {
  const [tab, setTab] = useState('overview');
  return (
    <>
      <div className="page-head"><h1>Platform admin</h1></div>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'overview', label: 'Overview' }, { id: 'users', label: 'Users' }, { id: 'orgs', label: 'Organizations' }, { id: 'audit', label: 'Audit log' }]} />
      {tab === 'overview' && <Overview />}
      {tab === 'users' && <Users />}
      {tab === 'orgs' && <Orgs />}
      {tab === 'audit' && <Audit />}
    </>
  );
}

function Overview() {
  const { data, isLoading } = useQuery({ queryKey: ['admin', 'stats'], queryFn: async () => (await api.get('/admin/stats')).data });
  if (isLoading) return <Spinner />;
  return (
    <div className="stats">
      <Stat label="Users" value={data.users} /><Stat label="Organizations" value={data.orgs} /><Stat label="Events" value={data.events} />
      <Stat label="Open disputes" value={data.openDisputes} />
      <Stat label="Paid out" value={rupees(data.payouts.paidAmount)} hint={`${data.payouts.count} payouts, ${data.payouts.failureRate}% failed`} />
      <Stat label="Platform fees" value={rupees(data.payouts.fees)} />
      <Stat label="Held in wallets" value={rupees(data.walletBalance)} />
    </div>
  );
}

function Users() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [applied, setApplied] = useState('');
  const { data, isLoading } = useQuery({ queryKey: ['admin', 'users', applied], queryFn: async () => (await api.get('/admin/users', { params: applied ? { q: applied } : {} })).data });
  const set = useMutation({
    mutationFn: async ({ id, status }) => (await api.patch(`/admin/users/${id}`, { status })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  });
  return (
    <>
      <form className="filters two-col" onSubmit={(e) => { e.preventDefault(); setApplied(q); }}>
        <input placeholder="Search name or email" value={q} onChange={(e) => setQ(e.target.value)} /><button className="btn btn-primary">Search</button>
      </form>
      <Notice>{set.error && errorMessage(set.error)}</Notice>
      {isLoading ? <Spinner /> : (
        <ul className="table">
          {data.users.map((u) => (
            <li key={u._id}>
              <div><strong>{u.name}</strong>, {u.email}<p className="muted small">{u.role}, reliability {u.reliabilityScore}</p></div>
              <div className="row">
                <Pill tone={u.status === 'active' ? 'good' : 'bad'}>{u.status}</Pill>
                {u.role !== 'admin' && <button className="btn btn-quiet" onClick={() => set.mutate({ id: u._id, status: u.status === 'active' ? 'suspended' : 'active' })}>{u.status === 'active' ? 'Suspend' : 'Reinstate'}</button>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function Orgs() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['admin', 'orgs'], queryFn: async () => (await api.get('/admin/orgs')).data.orgs });
  const verify = useMutation({
    mutationFn: async ({ id, verified }) => (await api.patch(`/admin/orgs/${id}`, { verified })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'orgs'] }),
  });
  if (isLoading) return <Spinner />;
  return (
    <ul className="table">
      {data.map((o) => (
        <li key={o._id}>
          <div><strong>{o.name}</strong><p className="muted small">{o.type}, {o.city}</p></div>
          <div className="row"><Pill tone={o.verified ? 'good' : 'neutral'}>{o.verified ? 'Verified' : 'Unverified'}</Pill><button className="btn btn-quiet" onClick={() => verify.mutate({ id: o._id, verified: !o.verified })}>{o.verified ? 'Remove badge' : 'Verify'}</button></div>
        </li>
      ))}
      {!data.length && <li><span className="muted">No organizations yet.</span></li>}
    </ul>
  );
}

function Audit() {
  const { data, isLoading } = useQuery({ queryKey: ['admin', 'audit'], queryFn: async () => (await api.get('/admin/audit')).data.logs });
  if (isLoading) return <Spinner />;
  if (!data.length) return <Empty title="No activity yet">Approvals, payouts and overrides are recorded here.</Empty>;
  return <ul className="table">{data.map((l) => <li key={l._id}><div><strong>{l.action}</strong><p className="muted small">{l.actor || 'system'}, {formatDateTime(l.createdAt)}</p></div></li>)}</ul>;
}
