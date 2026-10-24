import { timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { WebhookReceiver } from 'livekit-server-sdk';
import { z } from 'zod';
import CONFIG from '#config';
import db from '#db';
import { requireAuth } from '../auth.js';
import { validate } from '../middleware/validate.js';
import { collectorReport, diagnostics, ingestKey } from './runtime.js';
import { syncResponses } from './sync.js';

const timestamp = z.number().int().nonnegative().max(8640000000000000);
const record = z
	.record(z.string(), z.unknown())
	.refine(
		(v) => JSON.stringify(v).length <= 14000,
		'Diagnostic record too large',
	);
// Validate fields consumed by the dashboard; missing browser metrics stay unavailable.
const metric = z.number().finite().nullable().optional();
const audio = z.object({
	trackId: z.string(),
	participant: z.string().optional(),
	codec: z.string().optional(),
	bitrateKbps: metric,
	packetsLost: metric,
	lossPercent: metric,
	jitterMs: metric,
	rttMs: metric,
	concealedPercent: metric,
	jitterBufferMs: metric,
	audioLevel: metric,
	bytes: metric,
});
const metrics = record.pipe(
	z.object({
		connectionState: z.string().default('unknown'),
		connectionQuality: z.string().default('unknown'),
		transports: z
			.array(
				z.object({
					role: z.string(),
					path: z.string(),
					state: z.string().optional(),
					iceState: z.string().optional(),
					candidateType: z.string().optional(),
					protocol: z.string().optional(),
					relayProtocol: z.string().optional(),
					relayUrl: z.string().optional(),
					rttMs: metric,
					bytesSent: metric,
					bytesReceived: metric,
				}),
			)
			.max(32)
			.default([]),
		incomingAudio: z.array(audio).max(32).default([]),
		outgoingAudio: z.array(audio).max(32).default([]),
		localAudio: record.default({}),
		deviceState: record.default({}),
	}),
);
const event = z.object({
	seq: z.number().int().nonnegative(),
	at: timestamp,
	type: z.string().max(80),
	level: z.enum(['info', 'warning', 'error']).default('info'),
	message: z.string().max(2000),
	details: record.default({}),
});
const batch = z.object({
	events: z.array(event).max(60).default([]),
	samples: z
		.array(
			z.object({
				seq: z.number().int().nonnegative(),
				at: timestamp,
				data: metrics,
			}),
		)
		.max(20)
		.default([]),
	clientInfo: record.optional(),
});
export const diagnosticsRouter = Router();
diagnosticsRouter.use(requireAuth);
diagnosticsRouter.use(syncResponses());
const limits = new Map();
function limit(req, res, next) {
	const now = Date.now();
	const key = req.session.userId;
	let value = limits.get(key);
	if (!value || now - value.at > 60000) {
		value = { at: now, n: 0 };
		limits.set(key, value);
	}
	if (++value.n > 120)
		return res.status(429).json({ error: 'Diagnostics upload limit reached' });
	if (limits.size > 1000)
		for (const [k, v] of limits) if (now - v.at > 60000) limits.delete(k);
	next();
}
diagnosticsRouter.post(
	'/sessions',
	limit,
	validate(
		z.object({
			id: z.string().uuid(),
			roomName: z.string().min(1).max(64),
			clientInfo: record.default({}),
			attemptedAt: timestamp.optional(),
		}),
	),
	(req, res) => {
		const user = db.getUserById(req.session.userId);
		try {
			const s = diagnostics.ensureSession({
				...req.body,
				userId: user.id,
				username: user.username,
			});
			res.json({ id: s.id });
		} catch (error) {
			if (error.message.includes('different join'))
				return res.status(409).json({ error: error.message });
			throw error;
		}
	},
);
diagnosticsRouter.post(
	'/sessions/:id/batch',
	limit,
	validate(batch),
	(req, res) => {
		if (!diagnostics.ingest(req.params.id, req.session.userId, req.body))
			return res.status(404).json({ error: 'Diagnostic session not found' });
		res.json({ ok: true });
	},
);
function number(value, fallback) {
	return value !== undefined && Number.isFinite(Number(value))
		? Number(value)
		: fallback;
}
diagnosticsRouter.get('/overview', (req, res) =>
	res.json(diagnostics.overview(number(req.query.before, Date.now() + 1))),
);
diagnosticsRouter.get('/calls/:id', (req, res) => {
	const call = diagnostics.call(req.params.id);
	res.status(call ? 200 : 404).json(call ?? { error: 'Call not found' });
});
diagnosticsRouter.get('/sessions/:id', (req, res) => {
	const s = diagnostics.session(req.params.id);
	res.status(s ? 200 : 404).json(s ?? { error: 'Attempt not found' });
});
diagnosticsRouter.get('/events', (req, res) =>
	res.json(
		diagnostics.events({
			callId:
				typeof req.query.callId === 'string' ? req.query.callId : undefined,
			sessionId:
				typeof req.query.sessionId === 'string'
					? req.query.sessionId
					: undefined,
			before: number(req.query.before, Number.MAX_SAFE_INTEGER),
			level: typeof req.query.level === 'string' ? req.query.level : undefined,
			serverOnly: req.query.serverOnly === 'true',
		}),
	),
);
diagnosticsRouter.get('/samples/:id', (req, res) =>
	res.json(
		diagnostics.samples(
			req.params.id,
			number(
				req.query.from,
				number(req.query.windowMs, 0) > 0
					? Math.max(
							0,
							(diagnostics.session(req.params.id)?.ended_at ?? Date.now()) -
								number(req.query.windowMs, 0),
						)
					: 0,
			),
			number(req.query.to, Date.now()),
		),
	),
);
diagnosticsRouter.get('/server', (req, res) =>
	res.json(diagnostics.serverSamples()),
);

export async function webhook(req, res, next) {
	try {
		if (!CONFIG.LIVEKIT_API_KEY || !CONFIG.LIVEKIT_API_SECRET)
			return res.sendStatus(503);
		const receiver = new WebhookReceiver(
			CONFIG.LIVEKIT_API_KEY,
			CONFIG.LIVEKIT_API_SECRET,
		);
		let e;
		try {
			e = await receiver.receive(req.body.toString(), req.get('Authorization'));
		} catch {
			return res.sendStatus(401);
		}
		let metadata = {};
		try {
			metadata = JSON.parse(e.participant?.metadata || '{}');
		} catch {}
		diagnostics.lifecycle({
			id: e.id,
			type: e.event,
			at: Number(e.createdAt) * 1000 || Date.now(),
			roomName: e.room?.name,
			roomSid: e.room?.sid,
			participantSid: e.participant?.sid,
			identity: e.participant?.identity,
			metadata,
			reason:
				e.participant?.disconnectReason === undefined
					? null
					: String(e.participant.disconnectReason),
		});
		res.json({ ok: true });
	} catch (error) {
		next(error);
	}
}
export function internalReport(req, res) {
	const received = Buffer.from(req.get('X-Diagnostics-Key') || '');
	const expected = Buffer.from(ingestKey);
	if (
		received.length !== expected.length ||
		!timingSafeEqual(received, expected)
	)
		return res.sendStatus(401);
	const schema = z.object({
		services: record,
		events: z
			.array(
				z.object({
					id: z.string().max(128),
					source: z.enum(['livekit', 'gateway', 'backend', 'collector']),
					at: timestamp,
					level: z.enum(['warning', 'error', 'info']),
					message: z.string().max(2000),
					details: record.default({}),
				}),
			)
			.max(60),
	});
	const result = schema.safeParse(req.body);
	if (!result.success) return res.sendStatus(400);
	collectorReport(result.data);
	res.json({ ok: true });
}
