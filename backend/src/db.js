import { createMainDbService } from '@voice/db';
import CONFIG from '#config';

// The backend owns configuration; @voice/db owns connections and queries.
export default createMainDbService(CONFIG.DB_PATH);
