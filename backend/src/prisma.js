// backend/src/prisma.js
// Provides a shared, singleton Prisma Client instance for database operations.
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

module.exports = prisma;
