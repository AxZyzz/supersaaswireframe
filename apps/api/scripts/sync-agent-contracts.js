// Copies the agent JSON Schemas (source of truth: packages/shared/src/agents) next to the
// code that validates with them. A Jest test fails if the copies drift.
const fs = require('fs');
const path = require('path');
const from = path.join(__dirname, '..', '..', '..', 'packages', 'shared', 'src', 'agents');
const to = path.join(__dirname, '..', 'src', 'agents', 'contracts');
fs.mkdirSync(to, { recursive: true });
for (const f of fs.readdirSync(from).filter((n) => n.endsWith('.schema.json'))) {
  fs.copyFileSync(path.join(from, f), path.join(to, f));
  console.log('synced', f);
}
