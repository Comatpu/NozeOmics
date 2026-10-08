const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

// AppData is redirected for processes started by a Windows packaged app.
// A user-profile folder gives the desktop and its external MCP process one home.
function workspaceHome(env = process.env) {
  const profile = env.USERPROFILE || os.homedir();
  const shared = path.join(profile, 'NozeOmics');
  const configured = env.NOZEOMICS_HOME;
  if (!configured) {
    const developmentHome = path.resolve(__dirname, '../../../../../.local/development-data-home.txt');
    if (fs.existsSync(developmentHome)) return fs.readFileSync(developmentHome, 'utf8').trim();
    return shared;
  }
  const legacy = path.join(env.APPDATA || path.join(profile, 'AppData', 'Roaming'), 'NozeOmics');
  const normalize = value => path.resolve(value).toLowerCase();
  return normalize(configured) === normalize(legacy) ? shared : path.resolve(configured);
}

module.exports = {workspaceHome};
