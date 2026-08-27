// Re-export of the generated Prisma client.
//
// Kept as plain JS with a hand-written .d.ts rather than a compiled TS entry so
// that @kase/db needs no build step ahead of its consumers — `prisma generate`
// is the only prerequisite, which keeps test runs from depending on build order.
module.exports = require('@prisma/client');
