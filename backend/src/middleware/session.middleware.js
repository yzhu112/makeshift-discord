import db from '#db';

export function sessionMiddleware() {
	return (req, res, next) => {
		const sid = req?.cookies?.sid;
		if (!sid) return next();

		const row = db.getSessionBySid(sid);
		if (!row) return next();

		const { user_id, expires_at } = row;
		if (expires_at > 0 && expires_at < Date.now()) return next();

		req.session = {
			sid,
			userId: user_id,
		};

		return next();
	};
}
