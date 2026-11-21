// Jest cannot load the ESM-only `jose` that the A2A SDK imports (used only to verify signed agent
// cards, which we do not use). Production runs on Node >= 22.12, which can require() ESM.
module.exports = {};
