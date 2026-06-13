import cookieParser from 'cookie-parser';
import express from 'express';
import CONFIG from '#config';
import db from '#db';
import { requestLogger } from '#logger';
import { authRouter } from './auth.js';
import { livekitRouter } from './livekit.js';
import { sessionMiddleware } from './middleware/session.middleware.js';
import { roomRouter } from './room.js';

db.runMigrations();

if (CONFIG.NODE_ENV === 'production') {
	const CRITICAL_VARS = [
		'SESSION_SECRET',
		'INVITE_CODES',
		'LIVEKIT_URL',
		'LIVEKIT_API_SECRET',
		'LIVEKIT_API_KEY',
	];
	const error = CRITICAL_VARS.filter((config) => !CONFIG[config]).join(', ');

	if (error)
		throw new Error(`[ERROR] Missing critical environment variables: ${error}`);
}

const app = express();
const port = parseInt(CONFIG.PORT, 10) || 3000;

app.use(express.json());
app.use(cookieParser());
app.use(requestLogger());

app.use(sessionMiddleware());

app.get('/', (req, res) => {
	res.send('Hello World!');
});

app.use('/api', authRouter);
app.use('/api', livekitRouter);
app.use('/api', roomRouter);

app.get('/api/health', (req, res) => {
	req.log.info('health check');
	res.json({ ok: true, uptime: process.uptime() });
});

// ------------------- Undefined routes -------------------
app.use((req, res) => {
	req.log.info(`Attempt to access: ${req.path}`);
	res.status(404).json({ error: 'NOT FOUND' });
});

// Error handler
app.use((err, req, res, _next) => {
	req.log.error(err);
	const errMsg =
		CONFIG.NODE_ENV !== 'production'
			? `INTERNAL SERVER ERROR: ${err.message}`
			: 'INTERNAL SERVER ERROR';
	res.status(500).json({ error: errMsg });
});

app.listen(port, () => {
	console.log(`Example app listening on port ${port}`);
});
