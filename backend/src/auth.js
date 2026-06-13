import bcrypt from 'bcrypt';
import { Router } from 'express';
import CONFIG from '#config';
import db from '#db';
import { LoginSchema, SignupSchema, validate } from './middleware/validate.js';
import { createSession, destroySession } from './services/session.service.js';

export function requireAuth(req, res, next) {
	if (req?.session?.userId) return next();
	return res.status(401).json({ error: 'Unauthenticated' });
}

export const authRouter = Router();

// ------------------------------------ Unauthed ------------------------------------

authRouter.post('/signup', validate(SignupSchema), async (req, res) => {
	const { username, password, inviteCode } = req.body;

	const roomName = CONFIG.INVITE_CODES[inviteCode];
	if (!roomName) return res.status(401).json({ error: 'Invalid invite code' });

	const hash = await bcrypt.hash(password, 12);
	let user;
	try {
		user = db.createUser(username, hash);
		createSession(user.id, res);
	} catch (err) {
		if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
			return res.status(409).json({ error: 'Username taken' });
		}
		throw err;
	}

	db.joinRoom(user.id, roomName);
	return res.status(201).json(user);
});

authRouter.post('/login', validate(LoginSchema), async (req, res) => {
	const { username, password } = req.body;

	const row = db.getUserByUsername(username);
	if (!row) return res.status(401).json({ error: 'Invalid credentials' });

	const { id, password_hash } = row;
	const hashResult = await bcrypt.compare(password, password_hash);
	if (!hashResult)
		return res.status(401).json({ error: 'Invalid credentials' });

	createSession(id, res);
	res.status(200).json({ id, username });
});

authRouter.post('/logout', (req, res) => {
	destroySession(req, res);
	res.status(200).json({ ok: true });
});

// ------------------------------------ Authed ------------------------------------

authRouter.get('/me', requireAuth, (req, res) => {
	const user = db.getUserById(req.session.userId);
	if (!user) {
		destroySession(req, res);
		return res.status(401).json({ error: 'Unauthenticated' });
	}
	const rooms = db.getRoomMemberships(req.session.userId);
	res.status(200).json({ ...user, rooms });
});
