import pino, { stdSerializers } from 'pino';
import pinoHttp from 'pino-http';

export const logger = pino({
	redact: [
		'req.headers.cookie',
		'req.headers.authorization',
		'req.headers["x-diagnostics-key"]',
	],
});

export function requestLogger() {
	const middleware = pinoHttp({ logger, autoLogging: false });
	return (req, res, next) => {
		middleware(req, res, () => {
			logger.info({ req: stdSerializers.req(req) }, 'Incoming request:');
			req.log = logger.child({ reqId: req.id });
			next();
		});
	};
}
