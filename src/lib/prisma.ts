import { PrismaClient } from "@prisma/client";

// Instance unique réutilisée partout (évite d'épuiser les connexions en dev avec le hot-reload)
export const prisma = new PrismaClient();
