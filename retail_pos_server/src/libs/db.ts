import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

const connectionString =
  process.env.DATABASE_URL + "&uselibpqcompat=true" || "";
const adapter = new PrismaPg({ connectionString });
const db = new PrismaClient({ adapter });

export default db;
