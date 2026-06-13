export type Room = { name: string; code: string | null };
export type User = { id: number; username: string; rooms: Room[] };

export class ApiError extends Error {
	status: number;
	constructor(status: number, message: string) {
		super(message);
		this.status = status;
		this.name = 'ApiError';
	}
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(path, {
		...init,
		credentials: 'include',
		headers: {
			'Content-Type': 'application/json',
			...(init?.headers ?? {}),
		},
	});
	const body = await res.json().catch(() => ({}) as Record<string, unknown>);
	if (!res.ok) {
		const message =
			typeof body.error === 'string' ? body.error : 'Request failed';
		throw new ApiError(res.status, message);
	}
	return body as T;
}
