import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import db from '#db';
import { requireAuth } from './auth.js';
import {
	CreateRoomSchema,
	JoinRoomSchema,
	validate,
} from './middleware/validate.js';

// 8 hex chars (0-9, A-F) — shared out-of-band to gate protected rooms.
function generateRoomCode() {
	return randomBytes(4).toString('hex').toUpperCase();
}

export function requireRoomMembership(req, res, next) {
	const authedRooms = db
		.getRoomMemberships(req.session.userId)
		.map((room) => room.name);
	const requestedRoom = req.body?.roomName;

	if (authedRooms.includes(requestedRoom)) return next();

	return res.status(403).json({ error: 'Unauthorized' });
}

export const roomRouter = Router();

roomRouter.post(
	'/create-room',
	requireAuth,
	validate(CreateRoomSchema),
	(req, res) => {
		const { roomName, isProtected } = req.body;
		const code = isProtected ? generateRoomCode() : null;

		try {
			db.createRoom(roomName, code);
		} catch (err) {
			if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
				return res.status(409).json({ error: 'Room name taken' });
			}
			throw err; // unknown error — let error middleware handle it
		}
		db.joinRoom(req.session.userId, roomName);

		res.status(200).json({ roomName, code });
	},
);

roomRouter.post(
	'/join-room',
	requireAuth,
	validate(JoinRoomSchema),
	(req, res) => {
		const { roomName, code } = req.body;

		const room = db.getRoomCode(roomName);
		if (!room) return res.status(404).json({ error: 'Room not found' });

		// Regular rooms (null code) let anyone in; protected rooms need a match.
		if (room.code !== null && room.code !== code) {
			return res.status(403).json({ error: 'Room code incorrect' });
		}

		db.joinRoom(req.session.userId, roomName);
		res.status(200).json({ roomName, code: room.code });
	},
);
