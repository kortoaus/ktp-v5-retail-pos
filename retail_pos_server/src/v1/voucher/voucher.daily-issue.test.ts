import assert from "node:assert/strict";
import test from "node:test";

import { BadRequestException } from "../../libs/exceptions";
import type { StoreSettingModel, UserModel } from "../../generated/prisma/models";
import {
  DAILY_VOUCHER_ALREADY_ISSUED,
  issueDailyVoucherService,
} from "./voucher.service";

// R-2 — daily issue: when the pre-check read loses a race, the partial unique
// index (migration 20261008051333_staff_daily_voucher_unique) raises P2002 and
// the service answers with the same message. Fake client, no DB.

type Client = NonNullable<Parameters<typeof issueDailyVoucherService>[3]>;

function fakeClient(opts: { existing: boolean; createError?: unknown }) {
  const created: unknown[] = [];
  const tx = {
    voucher: {
      async create(args: { data: unknown }) {
        if (opts.createError) throw opts.createError;
        created.push(args.data);
        return { id: 1, ...(args.data as object) };
      },
    },
    voucherEvent: { async create() { return {}; } },
  };
  const client = {
    voucher: { async findFirst() { return opts.existing ? { id: 9 } : null; } },
    user: { async findUnique() { return { id: 7, archived: false }; } },
    async $transaction(fn: (t: typeof tx) => Promise<unknown>) {
      return fn(tx);
    },
  } as unknown as Client;
  return { client, created };
}

const SETTING = { user_daily_voucher_default: 1500 } as StoreSettingModel;
const ISSUER = { id: 1 } as UserModel;

test("pre-check hit → existing message", async () => {
  const { client } = fakeClient({ existing: true });
  await assert.rejects(issueDailyVoucherService(7, SETTING, ISSUER, client), (e: unknown) => {
    assert.ok(e instanceof BadRequestException);
    assert.equal(e.message, DAILY_VOUCHER_ALREADY_ISSUED);
    return true;
  });
});

test("race: pre-check passes, unique index rejects (P2002) → same message", async () => {
  const p2002 = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
  const { client } = fakeClient({ existing: false, createError: p2002 });
  await assert.rejects(issueDailyVoucherService(7, SETTING, ISSUER, client), (e: unknown) => {
    assert.ok(e instanceof BadRequestException);
    assert.equal(e.message, "Daily voucher already issued today");
    return true;
  });
});

test("first issue: validTo is the end of the Sydney day (the index key)", async () => {
  const { client, created } = fakeClient({ existing: false });
  const res = await issueDailyVoucherService(7, SETTING, ISSUER, client);
  assert.equal(res.ok, true);
  const data = created[0] as { validTo: Date; kind: string; balance: number };
  assert.equal(data.kind, "staff-daily");
  assert.equal(data.balance, 1500);
  const sydney = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Sydney",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(data.validTo);
  assert.equal(sydney, "23:59:59");
  assert.equal(data.validTo.getUTCMilliseconds(), 999);
});
