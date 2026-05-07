import { randomInt } from "node:crypto";

import type { Prisma } from "../../generated/prisma/client";

const INITIAL_DOC_COUNTER_MIN = 101;
const INITIAL_DOC_COUNTER_MAX_EXCLUSIVE = 1000;

type RandomIntFn = (min: number, max: number) => number;

export function randomInitialDocCounter(
  random: RandomIntFn = randomInt,
): number {
  const counter = random(
    INITIAL_DOC_COUNTER_MIN,
    INITIAL_DOC_COUNTER_MAX_EXCLUSIVE,
  );

  if (
    !Number.isInteger(counter) ||
    counter < INITIAL_DOC_COUNTER_MIN ||
    counter >= INITIAL_DOC_COUNTER_MAX_EXCLUSIVE
  ) {
    throw new RangeError(
      `initial doc counter ${counter} is outside supported range 101-999`,
    );
  }

  return counter;
}

export async function nextDocCounter(
  tx: Prisma.TransactionClient,
  dayStart: Date,
): Promise<number> {
  const doc = await tx.docCounter.upsert({
    where: { date: dayStart },
    update: { counter: { increment: 1 } },
    create: { date: dayStart, counter: randomInitialDocCounter() },
    select: { counter: true },
  });

  return doc.counter;
}
