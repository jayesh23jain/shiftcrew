import { Server } from 'socket.io';
import mongoose from 'mongoose';
import { env } from './config/env.js';
import { verifyAccessToken } from './utils/tokens.js';
import { Event } from './models/Event.js';
import { canAccessMissionControl, getMissionSnapshot } from './services/mission.service.js';

let ioInstance = null;
const eventUpdateTimers = new Map(); // eventId -> { timer, lastEmittedAt }

/**
 * Initializes the Socket.io server and hooks handshake authentication.
 *
 * @param {import('http').Server} httpServer
 * @returns {Server}
 */
export function initSocketServer(httpServer) {
  if (ioInstance) {
    return ioInstance;
  }

  const io = new Server(httpServer, {
    cors: {
      origin: [env.CLIENT_URL, 'http://localhost:5173', 'http://127.0.0.1:5173'],
      credentials: true,
      methods: ['GET', 'POST'],
    },
    transports: ['websocket', 'polling'],
  });

  // Handshake authentication middleware
  io.use(async (socket, next) => {
    try {
      const header = socket.handshake.headers?.authorization || '';
      const authHeaderToken = header.replace(/^Bearer\s+/i, '').trim();
      const token = socket.handshake.auth?.token || authHeaderToken;

      if (!token) {
        return next(new Error('Authentication token required'));
      }

      const payload = verifyAccessToken(token);
      socket.user = { id: payload.sub, role: payload.role };
      next();
    } catch (err) {
      next(new Error('Authentication failed: Invalid or expired token'));
    }
  });

  io.on('connection', (socket) => {
    // Join Event Mission Control room
    socket.on('join', async ({ eventId }, callback) => {
      try {
        if (!eventId || !mongoose.isValidObjectId(eventId)) {
          return callback?.({ error: 'Invalid or missing eventId' });
        }

        const event = await Event.findById(eventId);
        if (!event) {
          return callback?.({ error: 'Event not found' });
        }

        // Room authorization: Only members of event's organization, admin, or team leads of event roles
        const isAuthorized = await canAccessMissionControl(socket.user, event);
        if (!isAuthorized) {
          socket.emit('error', 'Unauthorized: Access restricted to organizers and team leads');
          return callback?.({ error: 'Unauthorized: Access restricted to organizers and team leads' });
        }

        const room = `event:${eventId}`;
        socket.join(room);

        // Immediately send initial snapshot to the joined socket
        const snapshot = await getMissionSnapshot(eventId);
        socket.emit('snapshot', snapshot);

        callback?.({ ok: true, room });
      } catch (err) {
        console.error('Socket join error:', err);
        callback?.({ error: err.message || 'Failed to join mission room' });
      }
    });

    // Leave room
    socket.on('leave', ({ eventId }) => {
      if (eventId) {
        socket.leave(`event:${eventId}`);
      }
    });

    socket.on('disconnect', () => {
      // Automatic socket cleanup by socket.io
    });
  });

  ioInstance = io;
  return io;
}

/**
 * Returns active Socket.io instance if initialized.
 */
export function getIO() {
  return ioInstance;
}

/**
 * Gracefully closes the Socket.io server (useful in tests/shutdown).
 */
export async function closeSocketServer() {
  if (ioInstance) {
    for (const [, entry] of eventUpdateTimers) {
      if (entry.timer) clearTimeout(entry.timer);
    }
    eventUpdateTimers.clear();
    await new Promise((resolve) => ioInstance.close(resolve));
    ioInstance = null;
  }
}

/**
 * Emits a throttled "update" event to "event:<id>" room.
 * Throttled to max 1 emission per second per event.
 *
 * @param {string|mongoose.Types.ObjectId} eventId
 * @param {Object} [meta] - metadata: { reason, details }
 */
export function emitMissionUpdate(eventId, { reason = 'change', details = null } = {}) {
  if (!ioInstance || !eventId) return;

  const evId = String(eventId);
  const room = `event:${evId}`;

  // If no sockets are currently connected in this room, skip DB computation
  const activeRoom = ioInstance.sockets.adapter.rooms.get(room);
  if (!activeRoom || activeRoom.size === 0) return;

  const now = Date.now();
  const state = eventUpdateTimers.get(evId) || { lastEmittedAt: 0, timer: null };

  const triggerEmission = async () => {
    state.timer = null;
    state.lastEmittedAt = Date.now();
    eventUpdateTimers.set(evId, state);

    try {
      const roomCheck = ioInstance.sockets.adapter.rooms.get(room);
      if (!roomCheck || roomCheck.size === 0) return;

      const snapshot = await getMissionSnapshot(evId);
      ioInstance.to(room).emit('update', {
        eventId: evId,
        timestamp: new Date().toISOString(),
        reason,
        details,
        snapshot,
      });
    } catch (err) {
      console.error(`emitMissionUpdate failed for event ${evId}:`, err.message);
    }
  };

  const elapsed = now - state.lastEmittedAt;
  if (elapsed >= 1000) {
    if (state.timer) clearTimeout(state.timer);
    triggerEmission();
  } else if (!state.timer) {
    const delay = 1000 - elapsed;
    state.timer = setTimeout(triggerEmission, delay);
    eventUpdateTimers.set(evId, state);
  }
}
