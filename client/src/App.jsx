import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import Layout from './components/Layout.jsx';
import RequireAuth from './components/RequireAuth.jsx';
import Landing from './pages/Landing.jsx';
import Events from './pages/Events.jsx';
import EventDetail from './pages/EventDetail.jsx';
import { Login, Register } from './pages/AuthPages.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Profile from './pages/Profile.jsx';
import EventForm from './pages/EventForm.jsx';
import EventManage from './pages/EventManage.jsx';
import MyShifts from './pages/MyShifts.jsx';
import QRPass from './pages/QRPass.jsx';
import SwapBoard from './pages/SwapBoard.jsx';
import Earnings from './pages/Earnings.jsx';
import { Certificates, Verify } from './pages/Certificates.jsx';
import Notifications from './pages/Notifications.jsx';
// The camera scanner library is large, so the check-in pages load only when opened.
const CheckInList = lazy(() => import('./pages/CheckIn.jsx').then((m) => ({ default: m.CheckInList })));
const CheckInShift = lazy(() => import('./pages/CheckIn.jsx').then((m) => ({ default: m.CheckInShift })));
import Admin from './pages/Admin.jsx';

export default function App() {
  const location = useLocation();
  return (
    <ErrorBoundary resetKey={location.pathname}>
    <Suspense fallback={<div className="spinner" role="status" aria-label="Loading"><span /></div>}>
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Landing />} />
        <Route path="events" element={<RequireAuth><Events /></RequireAuth>} />
        <Route path="events/:id" element={<RequireAuth><EventDetail /></RequireAuth>} />
        <Route path="login" element={<Login />} />
        <Route path="register" element={<Register />} />
        <Route path="dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />
        <Route path="profile" element={<RequireAuth><Profile /></RequireAuth>} />
        <Route path="manage/events/new" element={<RequireAuth roles={['organizer', 'admin']}><EventForm /></RequireAuth>} />
        <Route path="manage/events/:id" element={<RequireAuth roles={['organizer', 'admin']}><EventManage /></RequireAuth>} />
        <Route path="manage/events/:id/edit" element={<RequireAuth roles={['organizer', 'admin']}><EventForm /></RequireAuth>} />
        <Route path="my-shifts" element={<RequireAuth roles={['volunteer']}><MyShifts /></RequireAuth>} />
        <Route path="swap-board" element={<RequireAuth roles={['volunteer']}><SwapBoard /></RequireAuth>} />
        <Route path="swaps" element={<RequireAuth roles={['volunteer']}><SwapBoard /></RequireAuth>} />
        <Route path="pass/:shiftId" element={<RequireAuth roles={['volunteer']}><QRPass /></RequireAuth>} />
        <Route path="earnings" element={<RequireAuth roles={['volunteer']}><Earnings /></RequireAuth>} />
        <Route path="certificates" element={<RequireAuth><Certificates /></RequireAuth>} />
        <Route path="notifications" element={<RequireAuth><Notifications /></RequireAuth>} />
        <Route path="checkin" element={<RequireAuth><CheckInList /></RequireAuth>} />
        <Route path="checkin/:shiftId" element={<RequireAuth><CheckInShift /></RequireAuth>} />
        <Route path="admin" element={<RequireAuth roles={['admin']}><Admin /></RequireAuth>} />
        {/* Public: anyone can verify a certificate code */}
        <Route path="verify" element={<Verify />} />
        <Route path="verify/:code" element={<Verify />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
    </Suspense>
    </ErrorBoundary>
  );
}
