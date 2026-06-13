import { z } from 'zod';

export const validate = (schema) => (req, res, next) => {
	const result = schema.safeParse(req.body);
	if (!result.success) {
		const message = result.error.issues[0]?.message ?? 'Invalid input';
		return res.status(400).json({ error: message });
	}
	req.body = result.data;
	next();
};

export const SignupSchema = z.object({
	username: z.string().regex(/^[a-zA-Z0-9_]{1,32}$/, 'Invalid username'),
	password: z.string().min(8).max(128),
	inviteCode: z.string().min(1),
});

export const LoginSchema = z.object({
	username: z.string().min(1).max(64),
	password: z.string().min(1).max(128),
});

export const JoinRoomSchema = z.object({
	roomName: z.string().min(1).max(32),
	code: z.string().length(8).optional(),
});

export const CreateRoomSchema = z.object({
	roomName: z.string().min(1).max(32),
	isProtected: z.boolean().default(false),
});
