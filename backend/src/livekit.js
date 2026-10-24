import { Router } from 'express';
import { AccessToken } from 'livekit-server-sdk';
import { z } from 'zod';
import CONFIG from '#config';
import db from '#db';
import { requireAuth } from './auth.js';
import { diagnostics, safelyRecord } from './diagnostics/runtime.js';
import { validate } from './middleware/validate.js';
import { requireRoomMembership } from './room.js';

export const livekitRouter = Router();

const LivekitTokenSchema = z.object({
	roomName: z.string().min(1).max(64),
	diagnosticSessionId: z.string().uuid().optional(),
});

livekitRouter.post(
	'/livekit-token',
	requireAuth,
	validate(LivekitTokenSchema),
	(req, res, next) => {
		const { diagnosticSessionId: id, roomName } = req.body;
		if (id) {
			const user = db.getUserById(req.session.userId);
			try {
				diagnostics.ensureSession({
					id,
					roomName,
					userId: user.id,
					username: user.username,
				});
				safelyRecord({
					sessionId: id,
					type: 'token_requested',
					message: 'LiveKit token requested',
				});
				res.on('finish', () => {
					if (res.statusCode >= 400)
						safelyRecord({
							sessionId: id,
							type: 'token_failed',
							level: 'error',
							message: `Token endpoint returned HTTP ${res.statusCode}`,
							details: { status: res.statusCode },
						});
				});
			} catch {
				// Observability must not prevent an otherwise valid call.
				delete req.body.diagnosticSessionId;
			}
		}
		next();
	},
	requireRoomMembership,
	async (req, res) => {
		const { roomName } = req.body;
		const { username } = db.getUserById(req.session.userId);

		const token = new AccessToken(
			CONFIG.LIVEKIT_API_KEY,
			CONFIG.LIVEKIT_API_SECRET,
			{
				identity: username,
				ttl: '8h',
				metadata: req.body.diagnosticSessionId
					? JSON.stringify({
							diagnosticSessionId: req.body.diagnosticSessionId,
						})
					: undefined,
			},
		);

		token.addGrant({
			roomJoin: true,
			room: roomName,
			canPublish: true,
			canSubscribe: true,
		});

		const jwt = await token.toJwt();
		if (req.body.diagnosticSessionId)
			safelyRecord({
				sessionId: req.body.diagnosticSessionId,
				type: 'token_issued',
				message: 'LiveKit token issued',
			});

		res.status(200).json({ url: CONFIG.LIVEKIT_URL, token: jwt });
	},
);
