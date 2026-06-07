import crypto from 'crypto';
import CONFIG from '#config';
import db from '#db';

setInterval(
	() => {
		db.sweepStaleSessions();
	},
	60 * 60 * 1000,
);

export function createSession(userId, res) {
	const sid = crypto.randomBytes(32).toString('base64url');
	db.createSession(sid, userId);
	res.cookie('sid', sid, {
		httpOnly: true,
		sameSite: 'lax',
		secure: CONFIG.NODE_ENV === 'production',
		maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days
	});
	return sid;
}

export function destroySession(req, res) {
	const sid = req?.session?.sid;
	if (!sid) return;

	db.destroySession(sid);
	res.clearCookie('sid');
}
