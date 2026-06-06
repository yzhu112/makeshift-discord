import 'dotenv/config';
import { resolve } from 'node:path';

const CONFIG = {
	PORT: process.env.PORT,
	NODE_ENV: process.env.NODE_ENV,
	SESSION_SECRET: process.env.SESSION_SECRET,
	SIGNUP_SECRET: process.env.SIGNUP_SECRET,
	LIVEKIT_API_KEY: process.env.LIVEKIT_API_KEY,
	LIVEKIT_API_SECRET: process.env.LIVEKIT_API_SECRET,
	LIVEKIT_URL: process.env.LIVEKIT_URL,
	DB_PATH: resolve(process.env.DB_PATH ?? './data/voicechat.db'),
};

export default CONFIG;
