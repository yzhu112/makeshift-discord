import 'dotenv/config';
import { dirname, join, resolve } from 'node:path';

const CONFIG = {
	PORT: process.env.PORT,
	NODE_ENV: process.env.NODE_ENV,
	SESSION_SECRET: process.env.SESSION_SECRET,
	INVITE_CODES: JSON.parse(process.env.INVITE_CODES ?? '{}'),
	LIVEKIT_API_KEY: process.env.LIVEKIT_API_KEY,
	LIVEKIT_API_SECRET: process.env.LIVEKIT_API_SECRET,
	LIVEKIT_URL: process.env.LIVEKIT_URL,
	DB_PATH: resolve(process.env.DB_PATH ?? './data/voicechat.db'),
	DIAGNOSTICS_DB_PATH: resolve(
		process.env.DIAGNOSTICS_DB_PATH ??
			join(
				dirname(process.env.DB_PATH ?? './data/voicechat.db'),
				'diagnostics.db',
			),
	),
};

export default CONFIG;
