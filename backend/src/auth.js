import bcrypt from 'bcrypt';
import { Router } from 'express';
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
	// hash pwd
	const hash = await bcrypt.hash(password, 12);
	try {
		const user = db.createUser(username, hash);
		createSession(user.id, res);
		return res.status(201).json(user);
	} catch (err) {
		if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
			return res.status(409).json({ error: 'Username taken' });
		}
		throw err; // unknown error — let your error middleware handle it
	}
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
	res.status(200).json(user);
});
