// Prisma unique-constraint violation (P2002). Duck-typed on `code` so it works
// for PrismaClientKnownRequestError from any generated client and in tests.
export function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code?: unknown }).code === "P2002"
  );
}
