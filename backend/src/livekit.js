import { Router } from 'express';
import { AccessToken } from 'livekit-server-sdk';
import { z } from 'zod';
import CONFIG from '#config';
import db from '#db';
import { requireAuth } from './auth.js';
import { validate } from './middleware/validate.js';
import { requireRoomMembership } from './room.js';

export const livekitRouter = Router();

const LivekitTokenSchema = z.object({
	roomName: z.string().min(1).max(64),
});

livekitRouter.post(
	'/livekit-token',
	requireAuth,
	requireRoomMembership,
	validate(LivekitTokenSchema),
	async (req, res) => {
		const { roomName } = req.body;
		const { username } = db.getUserById(req.session.userId);

		const token = new AccessToken(
			CONFIG.LIVEKIT_API_KEY,
			CONFIG.LIVEKIT_API_SECRET,
			{
				identity: username,
				ttl: '8h',
			},
		);

		token.addGrant({
			roomJoin: true,
			room: roomName,
			canPublish: true,
			canSubscribe: true,
		});

		const jwt = await token.toJwt();

		res.status(200).json({ url: CONFIG.LIVEKIT_URL, token: jwt });
	},
);
