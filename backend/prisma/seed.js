// prisma/seed.js
// Seeds initial demonstration data required for the Bugify MVP.
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Starting Bugify database seeding...');

  // 1. Seed Demo User
  // DEV-ONLY: Plain placeholder password for development prior to authentication system implementation.
  const demoUser = await prisma.user.upsert({
    where: { email: 'demo@bugify.dev' },
    update: {},
    create: {
      name: 'Demo User',
      email: 'demo@bugify.dev',
      password: 'dev_placeholder_password_not_for_production',
    },
  });
  console.log(`Demo user ready: ${demoUser.email} (ID: ${demoUser.id})`);

  // 2. Seed UserProgress for the Demo User
  const userProgress = await prisma.userProgress.upsert({
    where: { userId: demoUser.id },
    update: {},
    create: {
      userId: demoUser.id,
      totalSubmissions: 0,
      successfulSubmissions: 0,
      failedSubmissions: 0,
    },
  });
  console.log(`User progress initialized for user ID ${demoUser.id}`);

  // 3. Seed Languages (Python and JavaScript)
  const python = await prisma.language.upsert({
    where: { name: 'python' },
    update: { version: '3.10' },
    create: {
      name: 'python',
      version: '3.10',
    },
  });

  const javascript = await prisma.language.upsert({
    where: { name: 'javascript' },
    update: { version: 'ES2022' },
    create: {
      name: 'javascript',
      version: 'ES2022',
    },
  });

  console.log(`Languages seeded: ${python.name} (${python.version}), ${javascript.name} (${javascript.version})`);
  console.log('Seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error('Error during seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
