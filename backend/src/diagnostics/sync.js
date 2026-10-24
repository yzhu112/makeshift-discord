import { createHash } from 'node:crypto';

const object = (value) =>
	value !== null && typeof value === 'object' && !Array.isArray(value);
const rows = (value) =>
	Array.isArray(value) &&
	value.every(
		(row) =>
			object(row) && (typeof row.id === 'string' || typeof row.id === 'number'),
	) &&
	new Set(value.map((row) => String(row.id))).size === value.length;
export function difference(previous, current, path = [], changes = []) {
	if (JSON.stringify(previous) === JSON.stringify(current)) return changes;
	if (rows(previous) && rows(current)) {
		const old = new Map(previous.map((row) => [String(row.id), row]));
		const ids = new Set(current.map((row) => String(row.id)));
		changes.push({
			type: 'rows',
			path,
			upsert: current.filter(
				(row) =>
					JSON.stringify(old.get(String(row.id))) !== JSON.stringify(row),
			),
			order: current.map((row) => String(row.id)),
			remove: previous
				.filter((row) => !ids.has(String(row.id)))
				.map((row) => String(row.id)),
		});
	} else if (object(previous) && object(current)) {
		for (const key of Object.keys(previous))
			if (!Object.hasOwn(current, key))
				changes.push({ type: 'remove', path: [...path, key] });
		for (const key of Object.keys(current))
			difference(previous[key], current[key], [...path, key], changes);
	} else changes.push({ type: 'set', path, value: current });
	return changes;
}

// Shared read-only snapshots, bounded for the small VPS. Eviction/restart simply
// causes the next client request to receive a fresh snapshot. SQLite is unaffected.
export function createSync({
	budget = 4 * 1024 * 1024,
	maxEntries = 128,
} = {}) {
	const cache = new Map();
	let bytes = 0;
	return (scope, revision, value) => {
		const json = JSON.stringify(value);
		const current = JSON.parse(json);
		const next = createHash('sha256')
			.update(scope)
			.update('\0')
			.update(json)
			.digest('hex')
			.slice(0, 32);
		const old = cache.get(revision);
		let response = { revision: next, data: current };
		if (old?.scope === scope) {
			const delta = { revision: next, changes: difference(old.value, current) };
			if (JSON.stringify(delta).length < JSON.stringify(response).length)
				response = delta;
		}
		if (!cache.has(next)) {
			const size = Buffer.byteLength(json);
			if (size <= budget) {
				cache.set(next, { scope, value: current, size });
				bytes += size;
			}
		}
		while (bytes > budget || cache.size > maxEntries) {
			const key = cache.keys().next().value;
			bytes -= cache.get(key).size;
			cache.delete(key);
		}
		return response;
	};
}
export function syncResponses() {
	const sync = createSync();
	return (req, res, next) => {
		if (req.method !== 'GET' || req.query.sync !== '1') return next();
		const json = res.json.bind(res);
		res.json = (value) => {
			if (res.statusCode !== 200) return json(value);
			const query = new URLSearchParams(req.originalUrl.split('?')[1] || '');
			query.delete('revision');
			query.delete('sync');
			query.sort();
			const scope = req.path + '?' + query;
			res.set('Cache-Control', 'no-store');
			return json(
				sync(
					scope,
					typeof req.query.revision === 'string'
						? req.query.revision
						: undefined,
					value,
				),
			);
		};
		next();
	};
}
