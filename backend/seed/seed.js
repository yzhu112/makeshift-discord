import { seedMainDatabase } from '@voice/db';
import CONFIG from '#config';

const names = Object.values(CONFIG.INVITE_CODES);
const fresh = process.argv.includes('--fresh');
seedMainDatabase(CONFIG.DB_PATH, names, { fresh });
if (fresh) console.log('recreated database');
for (const name of names) console.log(`seeded room: ${name}`);
