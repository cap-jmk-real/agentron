const fs = require('fs');
const path = require('path');
const releaseDir = path.join(__dirname, '..', 'release');
try {
  if (fs.existsSync(releaseDir)) {
    fs.rmSync(releaseDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  }
} catch (e) {
  console.warn('Could not clean release dir (close Agentron Studio, Cursor, and any Explorer windows on release/):', e.message);
  console.warn('Continuing - build may fail if files are locked.');
}
