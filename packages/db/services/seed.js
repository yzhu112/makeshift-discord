import { rmSync } from 'node:fs';
import { createMainDbService } from './main.js';

export function seedMainDatabase(path, roomNames, { fresh = false } = {}) {
	if (fresh) {
		for (const suffix of ['', '-wal', '-shm']) {
			rmSync(`${path}${suffix}`, { force: true });
		}
	}
	const service = createMainDbService(path);
	try {
		service.runMigrations();
		service.seedRooms(roomNames);
	} finally {
		service.close();
	}
}
