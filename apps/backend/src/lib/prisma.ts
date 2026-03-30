import prismaPkg from "@prisma/client";

const { PrismaClient } = prismaPkg;
type PrismaClientInstance = InstanceType<typeof PrismaClient>;

const globalForPrisma = global as unknown as { prisma: PrismaClientInstance };

export const prisma = globalForPrisma.prisma || new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
