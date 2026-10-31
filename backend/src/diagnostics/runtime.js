import { createHmac } from 'node:crypto';
import { readFileSync, statfsSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import { dirname } from 'node:path';
import tls from 'node:tls';
import { createDiagnosticsStore } from '@voice/db/diagnostics';
import { RoomServiceClient } from 'livekit-server-sdk';
import CONFIG from '#config';
import { logger } from '#logger';

export const diagnostics = createDiagnosticsStore(CONFIG.DIAGNOSTICS_DB_PATH);
export const ingestKey = createHmac(
	'sha256',
	CONFIG.SESSION_SECRET || 'local-development',
)
	.update('diagnostics-ingest-v1')
	.digest('hex');
let bootId;
try {
	bootId = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
} catch {
	bootId = os.hostname();
}
const serverId = bootId;
let timer;
let busy = false;
let stopped = false;
let previousCpu = os.cpus();
let collector = { at: null, services: {} };
export function collectorReport(report) {
	collector = { at: Date.now(), services: report.services };
	for (const e of report.events)
		diagnostics.record({
			source: e.source,
			sourceId: e.id,
			at: e.at,
			level: e.level,
			type: 'service_log',
			message: e.message,
			details: e.details,
		});
}
function probe(port, secure = false, hostname) {
	return new Promise((resolve) => {
		let done = false;
		const finish = (value) => {
			if (done) return;
			done = true;
			socket.destroy();
			resolve(value);
		};
		const socket = secure
			? tls.connect({
					host: '127.0.0.1',
					port,
					servername: hostname,
					rejectUnauthorized: true,
				})
			: net.connect({ host: '127.0.0.1', port });
		socket.setTimeout(1800, () =>
			finish({ status: 'unreachable', error: 'Connection timeout' }),
		);
		socket.on('error', (error) =>
			finish({ status: 'unreachable', error: error.code || error.message }),
		);
		socket.once(secure ? 'secureConnect' : 'connect', () =>
			finish({
				status: 'running',
				...(secure
					? {
							certificateExpiresAt: Date.parse(
								socket.getPeerCertificate().valid_to,
							),
						}
					: {}),
			}),
		);
	});
}
export function startDiagnostics() {
	const service =
		CONFIG.LIVEKIT_URL && CONFIG.LIVEKIT_API_KEY && CONFIG.LIVEKIT_API_SECRET
			? new RoomServiceClient(
					CONFIG.LIVEKIT_URL.replace(/^ws/, 'http'),
					CONFIG.LIVEKIT_API_KEY,
					CONFIG.LIVEKIT_API_SECRET,
				)
			: null;
	async function sample() {
		if (busy || stopped) return;
		busy = true;
		try {
			const current = os.cpus();
			let idle = 0,
				total = 0;
			current.forEach((cpu, i) => {
				const prev = previousCpu[i];
				if (!prev) return;
				idle += cpu.times.idle - prev.times.idle;
				total += Object.keys(cpu.times).reduce(
					(n, k) => n + cpu.times[k] - prev.times[k],
					0,
				);
			});
			previousCpu = current;
			const services = {
				backend: { status: 'running' },
				...collector.services,
			};
			if (service) {
				try {
					const snapshot = async () => {
						const rooms = await service.listRooms();
						return (
							await Promise.all(
								rooms.map(async (room) =>
									(
										await service.listParticipants(room.name)
									).map((p) => ({
										...p,
										roomName: room.name,
										roomSid: room.sid,
									})),
								),
							)
						).flat();
					};
					let timeout;
					try {
						const participants = await Promise.race([
							snapshot(),
							new Promise((_, reject) => {
								timeout = setTimeout(
									() => reject(new Error('LiveKit API timeout')),
									5000,
								);
							}),
						]);
						diagnostics.reconcile(participants);
						services.livekit = { ...services.livekit, status: 'running' };
					} finally {
						clearTimeout(timeout);
					}
				} catch (error) {
					services.livekit = {
						...services.livekit,
						status: 'unreachable',
						error: error.message,
					};
				}
			} else services.livekit = { status: 'not_configured' };
			if (CONFIG.NODE_ENV === 'production') {
				services.gateway = { ...services.gateway, ...(await probe(443)) };
				const hostname = new URL(CONFIG.LIVEKIT_URL).hostname;
				services.turn = { ...(await probe(443, true, 'turn.' + hostname)) };
			}
			const disk = statfsSync(dirname(CONFIG.DIAGNOSTICS_DB_PATH));
			diagnostics.serverSample(serverId, {
				cpuPercent: total ? Math.round((1 - idle / total) * 1000) / 10 : null,
				memoryUsedBytes: os.totalmem() - os.freemem(),
				memoryTotalBytes: os.totalmem(),
				processMemoryBytes: process.memoryUsage().rss,
				diskFreeBytes: disk.bavail * disk.bsize,
				uptimeSeconds: os.uptime(),
				backendUptimeSeconds: process.uptime(),
				services,
				collectorLastSeenAt: collector.at,
			});
		} catch (error) {
			logger.warn({ err: error }, 'Diagnostics sampling failed');
		} finally {
			busy = false;
		}
	}
	sample();
	timer = setInterval(sample, 60000);
	timer.unref();
	return () => {
		stopped = true;
		clearInterval(timer);
	};
}
export function safelyRecord(data) {
	try {
		diagnostics.record(data);
	} catch (error) {
		logger.warn({ err: error }, 'Diagnostics event unavailable');
	}
}
