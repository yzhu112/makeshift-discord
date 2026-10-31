import { inflateSync } from 'node:zlib';
import { PNG } from 'pngjs';
import { z } from 'zod';

export const MAX_AVATAR_BYTES = 512 * 1024;
const AVATAR_SIZE = 256;
const MAX_BASE64_LENGTH = 4 * Math.ceil(MAX_AVATAR_BYTES / 3);
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function decodeAvatar(value) {
	if (
		!value.length ||
		value.length > MAX_BASE64_LENGTH ||
		value.length % 4 !== 0 ||
		!/^[A-Za-z0-9+/]*={0,2}$/.test(value)
	)
		throw new Error('Avatar must be base64-encoded PNG data, at most 512 KiB.');

	const bytes = Buffer.from(value, 'base64');
	if (bytes.length > MAX_AVATAR_BYTES || bytes.toString('base64') !== value) {
		throw new Error('Avatar must be base64-encoded PNG data, at most 512 KiB.');
	}
	if (
		bytes.length < 33 ||
		!bytes.subarray(0, 8).equals(PNG_SIGNATURE) ||
		bytes.readUInt32BE(8) !== 13 ||
		bytes.toString('ascii', 12, 16) !== 'IHDR'
	)
		throw new Error('Avatar must be a valid PNG image.');
	if (
		bytes.readUInt32BE(16) !== AVATAR_SIZE ||
		bytes.readUInt32BE(20) !== AVATAR_SIZE
	) {
		throw new Error('Avatar must be exactly 256 by 256 pixels.');
	}

	// Inspect chunks before decoding: reject animation and bound decompression,
	// including interlaced PNGs (pngjs does not bound that inflate operation).
	const imageChunks = [];
	let ended = false;
	for (let offset = 8; offset < bytes.length; ) {
		if (offset + 12 > bytes.length)
			throw new Error('Avatar must be a valid PNG image.');
		const length = bytes.readUInt32BE(offset);
		const end = offset + 12 + length;
		if (end > bytes.length)
			throw new Error('Avatar must be a valid PNG image.');
		const type = bytes.toString('ascii', offset + 4, offset + 8);
		if (['acTL', 'fcTL', 'fdAT'].includes(type)) {
			throw new Error('Animated PNG avatars are not supported.');
		}
		if (type === 'IHDR' && offset !== 8)
			throw new Error('Avatar must be a valid PNG image.');
		if (type === 'IDAT') imageChunks.push(bytes.subarray(offset + 8, end - 4));
		if (type === 'IEND') {
			if (length !== 0 || end !== bytes.length)
				throw new Error('Avatar must be a valid PNG image.');
			ended = true;
		}
		offset = end;
	}
	if (!ended || !imageChunks.length)
		throw new Error('Avatar must be a valid PNG image.');
	try {
		// At most four 16-bit channels per pixel, plus interlace filter bytes.
		inflateSync(Buffer.concat(imageChunks), {
			maxOutputLength: AVATAR_SIZE * AVATAR_SIZE * 8 + AVATAR_SIZE * 7,
		});
		const decoded = PNG.sync.read(bytes, { checkCRC: true });
		if (decoded.width !== AVATAR_SIZE || decoded.height !== AVATAR_SIZE)
			throw new Error();
	} catch {
		throw new Error('Avatar must be a valid PNG image.');
	}
	return bytes;
}

const AvatarSchema = z.string().transform((value, context) => {
	try {
		return decodeAvatar(value);
	} catch (error) {
		context.addIssue({ code: 'custom', message: error.message });
		return z.NEVER;
	}
});

export const ProfileUpdateSchema = z
	.strictObject({
		display_name: z
			.string()
			.trim()
			.refine((value) => {
				const length = [...segmenter.segment(value)].length;
				return length >= 1 && length <= 32;
			}, 'Display name must contain 1 to 32 characters.')
			.nullable()
			.optional(),
		avatar: AvatarSchema.nullable().optional(),
		language: z.enum(['en', 'zh', 'ja']).nullable().optional(),
		theme: z.enum(['light', 'dark', 'system']).nullable().optional(),
	})
	.refine(
		(value) => Object.keys(value).length > 0,
		'Provide at least one profile field.',
	);

export const ProfileIncludeSchema = z
	.string()
	.transform((value) => value.split(','))
	.pipe(z.array(z.literal('avatar')).min(1))
	.optional();
