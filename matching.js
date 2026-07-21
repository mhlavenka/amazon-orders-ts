// Compatibility shim for consumers whose TypeScript config uses classic "node" module
// resolution (moduleResolution: "node", the default under "module": "commonjs") — that mode
// ignores package.json's "exports" field entirely, so `amazon-orders-ts/matching` only resolves
// if a physical file with that name exists at the package root. Node's own runtime resolver
// (and TS's newer "node16"/"nodenext"/"bundler" modes) already handle the "exports" map fine and
// never actually load this file — it's here purely for the classic-resolution case.
module.exports = require('./dist/matching/index.js');
