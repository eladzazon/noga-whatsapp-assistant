import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const packageJsonPath = path.join(__dirname, '..', '..', 'package.json');
const { version } = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

const startupDate = new Date().toISOString();

/**
 * Current running version info, sourced from package.json and build-time env vars.
 */
export function getVersionInfo() {
    return {
        version,
        gitCommit: process.env.GIT_COMMIT || 'unknown',
        buildDate: process.env.BUILD_DATE || startupDate
    };
}

export default { getVersionInfo };
