import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import api from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

const VOLUNTEER_SUGGESTIONS = [
  'When is my next shift?',
  'Was I paid for last week?',
  'Why was I marked late?',
  'What is the policy for late cancellations?',
  'How do payouts work?',
];

const ORGANIZER_SUGGESTIONS = [
  'Are there any volunteer stipends to pay?',
  'How do volunteer payouts work?',
  'What is the check-in window policy?',
  'What is the late cancellation policy?',
];

export default function AssistantDrawer({ isOpen, onClose }) {
  const { user } = useAuth();
  const isOrganizer = user?.role === 'organizer';
  const SUGGESTIONS = isOrganizer ? ORGANIZER_SUGGESTIONS : VOLUNTEER_SUGGESTIONS;

  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: isOrganizer
        ? 'Hello! I am your ShiftCrew organizer assistant. Ask me about your events, volunteer attendance, approved stipends awaiting payout, or ShiftCrew policies.'
        : 'Hello! I am your ShiftCrew assistant. Ask me about your upcoming shifts, attendance status, logged hours, earnings, or ShiftCrew policies.',
      sources: [],
      links: isOrganizer
        ? [
            { label: 'Dashboard', url: '/dashboard' },
            { label: 'Browse Events', url: '/events' },
          ]
        : [
            { label: 'My Shifts', url: '/my-shifts' },
            { label: 'Earnings', url: '/earnings' },
          ],
    },
  ]);
  const [input, setInput] = useState('');
  const [actionStatus, setActionStatus] = useState({}); // { [eventId]: { loading, sent, message, error } }
  const chatEndRef = useRef(null);

  // Fetch status & remaining message count
  const { data: status, refetch: refetchStatus } = useQuery({
    queryKey: ['assistant-status'],
    queryFn: async () => (await api.get('/assistant/status')).data,
    enabled: !!user && isOpen,
    refetchInterval: 30_000,
  });

  const remainingToday = status?.remainingToday ?? 20;
  const canUseUserData = status?.canUseUserData ?? false;
  const isEnabled = status?.enabled ?? true;

  // Auto-scroll to bottom of chat
  useEffect(() => {
    if (isOpen) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen]);

  // Send message mutation
  const sendMutation = useMutation({
    mutationFn: async (userMessage) => {
      // Build clean history array (last 6 turns)
      const historyPayload = messages.slice(-6).map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const res = await api.post('/assistant/chat', {
        message: userMessage,
        history: historyPayload,
      });
      return res.data;
    },
    onSuccess: (data) => {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: data.reply || 'No response generated.',
          sources: data.sources || [],
          links: data.links || [],
          actions: data.actions || [],
          fallback: data.fallback,
        },
      ]);
      refetchStatus();
    },
    onError: (err) => {
      const msg = err.response?.data?.message || err.message || 'Failed to reach assistant.';
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `⚠️ ${msg}`,
          sources: [],
          links: [
            { label: 'My Shifts', url: '/my-shifts' },
            { label: 'Earnings', url: '/earnings' },
          ],
        },
      ]);
      refetchStatus();
    },
  });

  const handleSend = (textToSend) => {
    const text = (textToSend || input).trim();
    if (!text || sendMutation.isPending || remainingToday <= 0) return;

    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    setInput('');
    sendMutation.mutate(text);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleAction = async (action) => {
    if (action.type === 'remind_organizer') {
      setActionStatus((prev) => ({
        ...prev,
        [action.eventId]: { loading: true },
      }));
      try {
        const res = await api.post('/assistant/remind-organizer', {
          eventId: action.eventId,
          payableId: action.payableId,
        });
        const resolvedName = res.data?.organizerName || action.organizerName || 'the organizer';
        setActionStatus((prev) => ({
          ...prev,
          [action.eventId]: {
            loading: false,
            sent: true,
            organizerName: resolvedName,
            message: res.data?.message || `Payment reminder sent to ${resolvedName}!`,
          },
        }));
      } catch (err) {
        setActionStatus((prev) => ({
          ...prev,
          [action.eventId]: {
            loading: false,
            sent: false,
            error: err.response?.data?.message || err.message || 'Failed to send reminder',
          },
        }));
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        justifyContent: 'flex-end',
        background: 'rgba(15, 23, 42, 0.45)',
        backdropFilter: 'blur(3px)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '460px',
          height: '100%',
          background: '#ffffff',
          borderLeft: '3px solid #0f172a',
          boxShadow: '-6px 0 0 rgba(15, 23, 42, 0.1)',
          display: 'flex',
          flexDirection: 'column',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drawer Header */}
        <div
          style={{
            padding: '1rem 1.15rem',
            background: '#ffffff',
            borderBottom: '2.5px solid #0f172a',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <span style={{ fontSize: '1.25rem' }}>✨</span>
              <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 900, color: '#0f172a' }}>
                {isOrganizer ? 'Organizer Assistant' : 'Volunteer Assistant'}
              </h2>
              <span
                style={{
                  fontSize: '0.68rem',
                  fontWeight: 900,
                  background: '#e0e7ff',
                  color: '#4338ca',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  border: '1px solid #c7d2fe',
                }}
              >
                AI
              </span>
            </div>
            <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.72rem', color: '#64748b', fontWeight: 600 }}>
              AI assistant • Can make mistakes, verify on My Shifts
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span
              style={{
                fontSize: '0.72rem',
                fontWeight: 800,
                color: remainingToday <= 3 ? '#b91c1c' : '#0f172a',
                background: remainingToday <= 3 ? '#fee2e2' : '#f1f5f9',
                padding: '3px 7px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
              }}
            >
              💬 {remainingToday}/20 today
            </span>
            <button
              type="button"
              onClick={onClose}
              style={{
                background: '#f8fafc',
                border: '1.5px solid #0f172a',
                borderRadius: '6px',
                width: '32px',
                height: '32px',
                cursor: 'pointer',
                fontWeight: 900,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              title="Close Assistant"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Privacy Guard Notice if LLM_ALLOW_USER_DATA is false */}
        {!canUseUserData && (
          <div
            style={{
              padding: '1rem',
              background: '#fffbeb',
              borderBottom: '2px solid #fde68a',
              color: '#92400e',
              fontSize: '0.8rem',
              lineHeight: 1.45,
            }}
          >
            <strong style={{ display: 'block', marginBottom: '0.35rem', color: '#78350f' }}>
              🔒 Assistant is Paused (Privacy Protection)
            </strong>
            To protect your privacy, volunteer schedule and earnings data are not sent to external AI models unless
            explicitly allowed.
            <div style={{ marginTop: '0.5rem', fontSize: '0.74rem' }}>
              <strong>How to enable:</strong> In <code>server/.env</code>, configure{' '}
              <code>LLM_ALLOW_USER_DATA=true</code> alongside a local Ollama model or an enterprise provider with
              zero data retention terms.
            </div>
          </div>
        )}

        {/* Chat Messages Body */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '1rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.9rem',
            background: '#fafaf9',
          }}
        >
          {messages.map((m, idx) => {
            const isUser = m.role === 'user';
            return (
              <div
                key={idx}
                style={{
                  alignSelf: isUser ? 'flex-end' : 'flex-start',
                  maxWidth: '88%',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.35rem',
                }}
              >
                <div
                  style={{
                    background: isUser ? '#0f172a' : '#ffffff',
                    color: isUser ? '#ffffff' : '#0f172a',
                    padding: '0.7rem 0.9rem',
                    borderRadius: isUser ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                    border: '1.5px solid #0f172a',
                    boxShadow: isUser ? '2px 2px 0 #334155' : '2px 2px 0 #cbd5e1',
                    fontSize: '0.86rem',
                    lineHeight: 1.45,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {m.content}
                </div>

                {/* Sources Used Cards */}
                {!isUser && m.sources && m.sources.length > 0 && (
                  <div
                    style={{
                      background: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      borderRadius: '6px',
                      padding: '0.4rem 0.55rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.2rem',
                    }}
                  >
                    <span style={{ fontSize: '0.68rem', fontWeight: 800, color: '#64748b' }}>
                      📚 Based on records:
                    </span>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                      {m.sources.map((src, sIdx) => (
                        <span
                          key={sIdx}
                          style={{
                            fontSize: '0.68rem',
                            fontWeight: 700,
                            background: '#e2e8f0',
                            color: '#334155',
                            padding: '1px 6px',
                            borderRadius: '4px',
                          }}
                        >
                          {src}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Interactive Action Buttons */}
                {!isUser && m.actions && m.actions.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: '0.3rem' }}>
                    {m.actions.map((act, aIdx) => {
                      const st = actionStatus[act.eventId] || {};
                      return (
                        <div key={aIdx} style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                          <button
                            type="button"
                            onClick={() => handleAction(act)}
                            disabled={st.loading || st.sent}
                            style={{
                              background: st.sent ? '#16a34a' : '#4f46e5',
                              color: '#ffffff',
                              border: '1.5px solid #0f172a',
                              borderRadius: '8px',
                              fontWeight: 900,
                              fontSize: '0.78rem',
                              padding: '0.45rem 0.85rem',
                              cursor: st.sent ? 'default' : st.loading ? 'wait' : 'pointer',
                              boxShadow: '2px 2px 0 #0f172a',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.35rem',
                              width: 'fit-content',
                              transition: 'all 0.15s ease',
                            }}
                          >
                            {st.loading ? (
                              <>⏳ Sending reminder...</>
                            ) : st.sent ? (
                              <>✅ Reminder Sent to {st.organizerName || act.organizerName}</>
                            ) : (
                              <>{act.label || `🔔 Remind ${act.organizerName} (₹${act.amountRupees})`}</>
                            )}
                          </button>
                          {st.sent && (
                            <span style={{ fontSize: '0.72rem', color: '#15803d', fontWeight: 800 }}>
                              {st.message || `Payment reminder has been sent to ${st.organizerName || act.organizerName}!`}
                            </span>
                          )}
                          {st.error && (
                            <span style={{ fontSize: '0.72rem', color: '#b91c1c', fontWeight: 800 }}>
                              ⚠️ {st.error}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Quick Action Links */}
                {!isUser && m.links && m.links.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginTop: '0.15rem' }}>
                    {m.links.map((link, lIdx) => (
                      <Link
                        key={lIdx}
                        to={link.url}
                        onClick={onClose}
                        style={{
                          fontSize: '0.74rem',
                          fontWeight: 800,
                          color: '#4338ca',
                          background: '#eef2ff',
                          border: '1px solid #c7d2fe',
                          padding: '2px 8px',
                          borderRadius: '6px',
                          textDecoration: 'none',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.2rem',
                        }}
                      >
                        👉 {link.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* Typing State Indicator */}
          {sendMutation.isPending && (
            <div
              style={{
                alignSelf: 'flex-start',
                background: '#ffffff',
                border: '1.5px solid #0f172a',
                borderRadius: '12px 12px 12px 2px',
                padding: '0.65rem 0.85rem',
                fontSize: '0.8rem',
                color: '#475569',
                display: 'flex',
                alignItems: 'center',
                gap: '0.45rem',
                boxShadow: '2px 2px 0 #cbd5e1',
              }}
            >
              <span>Checking your shifts & earnings records</span>
              <span style={{ display: 'inline-flex', gap: '2px', fontWeight: 900 }}>...</span>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        {/* Suggestion Chips */}
        {canUseUserData && remainingToday > 0 && (
          <div
            style={{
              padding: '0.5rem 0.75rem',
              background: '#f8fafc',
              borderTop: '1px solid #e2e8f0',
              display: 'flex',
              gap: '0.4rem',
              overflowX: 'auto',
              whiteSpace: 'nowrap',
            }}
          >
            {SUGGESTIONS.map((s, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handleSend(s)}
                disabled={sendMutation.isPending}
                style={{
                  fontSize: '0.73rem',
                  fontWeight: 700,
                  background: '#ffffff',
                  border: '1.5px solid #cbd5e1',
                  borderRadius: '999px',
                  padding: '3px 10px',
                  color: '#1e293b',
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {/* Chat Input Bar */}
        <div
          style={{
            padding: '0.85rem 1rem',
            background: '#ffffff',
            borderTop: '2.5px solid #0f172a',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.4rem',
          }}
        >
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value.slice(0, 500))}
              onKeyDown={handleKeyDown}
              placeholder={
                !canUseUserData
                  ? 'Assistant paused (see notice above)'
                  : remainingToday <= 0
                  ? 'Daily limit of 20 messages reached'
                  : 'Ask about your shifts, earnings, or policies...'
              }
              disabled={!canUseUserData || remainingToday <= 0 || sendMutation.isPending}
              style={{
                flex: 1,
                fontSize: '0.88rem',
                padding: '0.55rem 0.75rem',
                border: '1.5px solid #0f172a',
                borderRadius: '8px',
                outline: 'none',
                background: !canUseUserData || remainingToday <= 0 ? '#f1f5f9' : '#ffffff',
              }}
            />
            <button
              type="button"
              onClick={() => handleSend()}
              disabled={!canUseUserData || remainingToday <= 0 || !input.trim() || sendMutation.isPending}
              style={{
                background: '#4f46e5',
                color: '#ffffff',
                border: '1.5px solid #0f172a',
                borderRadius: '8px',
                fontWeight: 900,
                fontSize: '0.88rem',
                padding: '0.55rem 1.05rem',
                cursor: !canUseUserData || remainingToday <= 0 || !input.trim() || sendMutation.isPending ? 'not-allowed' : 'pointer',
                opacity: !canUseUserData || remainingToday <= 0 || !input.trim() || sendMutation.isPending ? 0.5 : 1,
                boxShadow: '2px 2px 0 #0f172a',
              }}
            >
              Send
            </button>
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '0.68rem',
              color: '#94a3b8',
              fontWeight: 600,
            }}
          >
            <span>Read-only assistant. Cannot modify shifts or process payments.</span>
            <span>{input.length}/500</span>
          </div>
        </div>
      </div>
    </div>
  );
}
