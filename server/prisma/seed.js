const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // Seed Sites 
  const siteCount = await prisma.site.count();
  if (siteCount === 0) {
    await prisma.site.createMany({
      data: [
        { number: 1, type: 'STANDARD', lengthFt: 40, pullThrough: true,  active: true },
        { number: 2, type: 'TRAILER',  lengthFt: 45, pullThrough: false, active: true },
        { number: 3, type: 'DRY',      lengthFt: 30, pullThrough: false, active: true },
        { number: 4, type: 'TENT',     lengthFt: 20, pullThrough: false, active: true },
      ],
    });
    console.log('Seeded sample sites.');
  } else {
    console.log('Sites already present, skipping sites.');
  }

}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => { console.error(e); return prisma.$disconnect(); });
