/**
 * Deterministic mock adapter used by tests and offline environments.
 * Tests must never call a real LLM.
 */
class MockAdapter {
  constructor() {
    this.customHandler = null;
    this.queuedResponses = [];
    this.callHistory = [];
  }

  setHandler(fn) {
    this.customHandler = fn;
  }

  queueResponse(res) {
    this.queuedResponses.push(res);
  }

  reset() {
    this.customHandler = null;
    this.queuedResponses = [];
    this.callHistory = [];
  }

  async complete({ system, messages, schema, tools, maxTokens, temperature, model }) {
    this.callHistory.push({ system, messages, schema, tools, maxTokens, temperature, model });

    if (this.queuedResponses.length > 0) {
      const next = this.queuedResponses.shift();
      if (next instanceof Error) throw next;
      if (typeof next === 'function') return next({ system, messages, schema, tools, maxTokens, temperature, model });
      return {
        content: next.content || '',
        toolCalls: next.toolCalls || [],
        usage: next.usage || { promptTokens: 50, completionTokens: 50, totalTokens: 100 },
      };
    }

    if (this.customHandler) {
      return this.customHandler({ system, messages, schema, tools, maxTokens, temperature, model });
    }

    // If caller is assistant or tools are provided, provide intelligent assistant simulation in English
    const isAssistant = (system && system.includes('ShiftCrew Volunteer Assistant')) || (tools && tools.length > 0);
    if (isAssistant && messages && messages.length > 0) {
      const last = messages[messages.length - 1];

      // If last message is tool result, synthesize a grounded English response
      if (last.role === 'tool') {
        let toolData = {};
        try {
          let cleaned = typeof last.content === 'string' ? last.content : JSON.stringify(last.content);
          if (cleaned.startsWith('<<<USER_DATA\n') && cleaned.endsWith('\n>>>')) {
            cleaned = cleaned.slice('<<<USER_DATA\n'.length, cleaned.length - '\n>>>'.length);
          } else {
            cleaned = cleaned.replace(/^<<<USER_DATA[^\n]*\n?/, '').replace(/\n?>>>\s*$/, '');
          }
          cleaned = cleaned.replace(/<\\<<USER_DATA/g, '<<<USER_DATA').replace(/>\\>>/g, '>>>');
          toolData = JSON.parse(cleaned);
        } catch {
          toolData = {};
        }

        if (last.name === 'getMyEarningsSummary') {
          const pending = toolData.pendingPayments || [];
          if (pending.length > 0) {
            const byEvent = new Map();
            for (const p of pending) {
              if (!byEvent.has(p.eventId)) {
                byEvent.set(p.eventId, { ...p, totalAmount: p.amountRupees });
              } else {
                byEvent.get(p.eventId).totalAmount += p.amountRupees;
              }
            }
            const list = [...byEvent.values()]
              .map(
                (p) =>
                  `• Event Name: **${p.eventTitle}**\n  • Amount Due: **₹${p.totalAmount}**\n  • Organizer: **${p.organizerPersonName || p.organizerName}**\n  • Status: **${p.status}**`
              )
              .join('\n\n');
            const target = [...byEvent.values()][0];
            const targetName = target?.organizerPersonName || target?.organizerName || 'the organizer';
            return {
              content: `Yes, you have a pending payment of ₹${target.totalAmount} to be received for your completed shift:\n\n${list}\n\nYou can click the button below to send a payment reminder to ${targetName}.\n\nBased on: Earnings Summary`,
              usage: { promptTokens: 90, completionTokens: 60, totalTokens: 150 },
            };
          }
          return {
            content: `You do not have any pending payments to be received right now. Total paid so far: ₹${toolData.totalPaidRupees || 0}. If you recently finished a shift, the organizer may still be reviewing attendance before payout release.\n\nBased on: Earnings Summary`,
            usage: { promptTokens: 80, completionTokens: 40, totalTokens: 120 },
          };
        }

        if (last.name === 'getMyUpcomingShifts') {
          const shifts = toolData.shifts || [];
          if (shifts.length > 0) {
            const s = shifts[0];
            return {
              content: `Your next shift is **${s.roleName}** for **${s.eventTitle}** at **${s.venueName || 'Venue'}** scheduled from ${s.start ? new Date(s.start).toLocaleString() : 'TBD'} to ${s.end ? new Date(s.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'TBD'} (Pay: ₹${s.rateRupees}).\n\nBased on: My Upcoming Shifts`,
              usage: { promptTokens: 90, completionTokens: 50, totalTokens: 140 },
            };
          }
          return {
            content: `You do not have any upcoming shifts scheduled at this time. You can find and join open shifts under Browse Events.\n\nBased on: My Upcoming Shifts`,
            usage: { promptTokens: 70, completionTokens: 30, totalTokens: 100 },
          };
        }

        if (last.name === 'getMyAttendanceStatus') {
          return {
            content: `Your attendance record for this shift is **${toolData.status || 'recorded'}** with ${toolData.minutesWorked || 0} minutes worked.${toolData.late ? ' (Flagged as Late).' : ''}\n\nBased on: Attendance`,
            usage: { promptTokens: 80, completionTokens: 30, totalTokens: 110 },
          };
        }

        if (last.name === 'getOrganizerPendingPayouts') {
          const items = toolData.items || [];
          if (items.length > 0) {
            const list = items
              .map(
                (it) =>
                  `• Event: **${it.eventTitle}**\n  • Volunteer: **${it.volunteerName}**\n  • Amount Due: **₹${it.amountRupees}**\n  • Action: Disburse in [Funds Tab](${it.manageFundsUrl})`
              )
              .join('\n\n');
            return {
              content: `Yes, you have **${items.length} approved volunteer stipend${items.length > 1 ? 's' : ''}** totaling **₹${toolData.totalAmountRupees}** awaiting payout release:\n\n${list}\n\nYou can disburse payments via Razorpay or your wallet in the Event Manage Funds tab.\n\nBased on: Organizer Pending Payouts`,
              usage: { promptTokens: 90, completionTokens: 60, totalTokens: 150 },
            };
          }
          return {
            content: `You do not have any volunteer stipends awaiting payout release at this time. All approved shifts have been paid.\n\nBased on: Organizer Pending Payouts`,
            usage: { promptTokens: 70, completionTokens: 30, totalTokens: 100 },
          };
        }

        if (last.name === 'getOrganizerEventsSummary') {
          const events = toolData.events || [];
          if (events.length > 0) {
            const list = events
              .map(
                (e) =>
                  `• **${e.title}** (${e.status.toUpperCase()})\n  • Shifts: ${e.totalShifts} | Capacity: ${e.totalCapacity} | Spots Left: ${e.spotsLeft} | Confirmed Volunteers: ${e.confirmedSignups}\n  • Manage: [Event Dashboard](${e.manageUrl})`
              )
              .join('\n\n');
            return {
              content: `Here is the current status of your organized events:\n\n${list}\n\nBased on: Organizer Events Summary`,
              usage: { promptTokens: 90, completionTokens: 60, totalTokens: 150 },
            };
          }
          return {
            content: `You currently do not have any created events. You can create a new event from your Dashboard.\n\nBased on: Organizer Events Summary`,
            usage: { promptTokens: 70, completionTokens: 30, totalTokens: 100 },
          };
        }

        if (last.name === 'getPolicyInfo') {
          return {
            content: `${toolData.policy || 'Policy details retrieved.'}\n\nBased on: Policy (${toolData.topic || 'general'})`,
            usage: { promptTokens: 70, completionTokens: 40, totalTokens: 110 },
          };
        }
      }

      // If last message is from user, pick appropriate tool call
      if (last.role === 'user') {
        let text = typeof last.content === 'string' ? last.content : JSON.stringify(last.content);
        if (text.startsWith('<<<USER_DATA\n') && text.endsWith('\n>>>')) {
          text = text.slice('<<<USER_DATA\n'.length, text.length - '\n>>>'.length);
        } else {
          text = text.replace(/^<<<USER_DATA[^\n]*\n?/, '').replace(/\n?>>>\s*$/, '');
        }
        text = text.replace(/<\\<<USER_DATA/g, '<<<USER_DATA').replace(/>\\>>/g, '>>>').toLowerCase();

        const isOrganizer = (system || '').includes('Organizer Assistant');
        if (isOrganizer) {
          if (/pay|payout|stipend|shift.*pay|pay.*shift|due|owing|pending|cost|fee/i.test(text)) {
            return {
              content: '',
              toolCalls: [
                {
                  id: `call_org_payout_${Date.now()}`,
                  type: 'function',
                  function: { name: 'getOrganizerPendingPayouts', arguments: '{}' },
                },
              ],
              usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
            };
          }
          if (/event|roster|volunteer.*sign|signups|capacity|spots|my events|manage|shifts/i.test(text)) {
            return {
              content: '',
              toolCalls: [
                {
                  id: `call_org_events_${Date.now()}`,
                  type: 'function',
                  function: { name: 'getOrganizerEventsSummary', arguments: '{}' },
                },
              ],
              usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
            };
          }
        }

        // 1. Payment, stipend, or completed shift earnings inquiry
        if (
          /pay|paid|payout|earn|money|recive|receive|due|amount|stipend|unpaid|owed|owing|balance|fee|settle|pending/i.test(text) ||
          /(completed|finished|done|attended|past|compketed).*(shift|work)/i.test(text) ||
          /(shift|work).*(completed|finished|done|attended|past|compketed)/i.test(text)
        ) {
          return {
            content: '',
            toolCalls: [
              {
                id: `call_earn_${Date.now()}`,
                type: 'function',
                function: { name: 'getMyEarningsSummary', arguments: '{}' },
              },
            ],
            usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
          };
        }

        // 2. Applying / finding new shifts / exploring options
        if (/apply|join|find|browse|another shift|new shift|open shift|options/i.test(text)) {
          return {
            content: `You can explore and apply to open shifts directly on the Browse Events page (/events). As a read-only assistant, I can view your confirmed schedule and earnings, but I cannot register you for new shifts directly.\n\nBased on: ShiftCrew Policy`,
            usage: { promptTokens: 60, completionTokens: 40, totalTokens: 100 },
          };
        }

        // 3. Swapping shifts
        if (/swap/i.test(text)) {
          return {
            content: `To request or accept a shift swap with another volunteer, visit the Shift Swap Board (/swaps).\n\nBased on: ShiftCrew Policy`,
            usage: { promptTokens: 50, completionTokens: 30, totalTokens: 80 },
          };
        }

        // 4. Cancelling a shift
        if (/cancel.*shift|drop.*shift/i.test(text)) {
          return {
            content: `To cancel a shift you cannot attend, please go to My Shifts (/my-shifts). Please provide at least 24 hours advance notice to avoid a late-cancellation penalty.\n\nBased on: Policy (late-cancel penalty)`,
            usage: { promptTokens: 60, completionTokens: 35, totalTokens: 95 },
          };
        }

        // 5. Viewing scheduled / upcoming shifts
        if (/shift|next|upcoming|when|schedule|time/i.test(text)) {
          return {
            content: '',
            toolCalls: [
              {
                id: `call_shift_${Date.now()}`,
                type: 'function',
                function: { name: 'getMyUpcomingShifts', arguments: '{}' },
              },
            ],
            usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
          };
        }

        if (/policy|cancel|late|dispute|window|check/i.test(text)) {
          const topic = /cancel|late/i.test(text)
            ? 'late-cancel penalty'
            : /dispute/i.test(text)
            ? 'dispute window'
            : /check/i.test(text)
            ? 'check-in window'
            : 'payouts';
          return {
            content: '',
            toolCalls: [
              {
                id: `call_pol_${Date.now()}`,
                type: 'function',
                function: { name: 'getPolicyInfo', arguments: JSON.stringify({ topic }) },
              },
            ],
            usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
          };
        }

        return {
          content: `Hello! I am your ShiftCrew assistant. I can answer questions in English about your shifts, attendance records, earnings, or policies.\n\nBased on: Volunteer Assistant`,
          usage: { promptTokens: 40, completionTokens: 30, totalTokens: 70 },
        };
      }
    }

    // Default deterministic response for plan draft
    const defaultDraft = {
      roles: [
        {
          name: 'Registration & Check-In',
          description: 'Welcome attendees, check badges, distribute kits',
          skills: ['Communication', 'Customer Service'],
        },
        {
          name: 'Stage & AV Crew',
          description: 'Manage audio, mics, slides, and stage timing',
          skills: ['Audio/Video', 'Technical Support'],
        },
      ],
      shifts: [
        {
          roleName: 'Registration & Check-In',
          dayIndex: 0,
          startTime: '08:30',
          durationMinutes: 240,
          capacity: 5,
          payType: 'unpaid',
          rateRupees: 0,
          notes: 'Arrive 15 mins prior for briefing',
        },
        {
          roleName: 'Stage & AV Crew',
          dayIndex: 0,
          startTime: '09:00',
          durationMinutes: 360,
          capacity: 3,
          payType: 'flat',
          rateRupees: 500,
          notes: 'Coordinate with main stage director',
        },
      ],
      assumptions: ['Event takes place over a single day', 'Briefing held at shift start'],
      warnings: [],
    };

    return {
      content: JSON.stringify(defaultDraft),
      usage: {
        promptTokens: 120,
        completionTokens: 180,
        totalTokens: 300,
      },
    };
  }
}

export const mockAdapter = new MockAdapter();
