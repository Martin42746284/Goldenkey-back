import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcrypt";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const prisma = new PrismaClient();
// recrée __dirname en mode ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUT_FILE = path.join(__dirname, "seed_credentials.json");

async function generatePassword(): Promise<string> {
  return crypto.randomBytes(8).toString("hex");
}

async function main() {
  const availableRoles = (Object.values(Role) as string[]).filter(Boolean);
  const fallback = ["ADMIN", "MANAGER", "RECEPTION", "HOUSEKEEPING", "KITCHEN", "WAITER", "BARTENDER", "CASHIER", "GUEST"];
  const roles = availableRoles.length ? availableRoles : fallback;

  const total = 9;
  const createdPasswords: { email: string; password: string; role: string }[] = [];

  for (let i = 0; i < total; i++) {
    const roleStr = roles[i] ?? roles[i % roles.length];
    const role = roleStr as Role;
    const email = `${role.toLowerCase()}${i + 1}@vatola_bub.com`;
    const name = `${role.charAt(0).toUpperCase() + role.slice(1).toLowerCase()} ${i + 1}`;

    const plain = await generatePassword();
    const hash = await bcrypt.hash(plain, 10);

    await prisma.user.upsert({
      where: { email },
      update: { name, role, password: hash },
      create: {
        email,
        name,
        role,
        password: hash,
      },
    });

    createdPasswords.push({ email, password: plain, role: roleStr });
    console.log(`Upserted user: ${email} role=${roleStr}`);
  }

  // write credentials to file (overwrite) — file contains plain passwords for bootstrap only
  await fs.writeFile(OUT_FILE, JSON.stringify(createdPasswords, null, 2), { encoding: "utf8", mode: 0o600 });
  console.log(`\nSeed finished. Credentials written to: ${OUT_FILE}`);
  console.log("Delete this file after you have recorded the passwords.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });