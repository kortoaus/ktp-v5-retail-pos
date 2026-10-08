-- R-2 (T-12): one staff-daily voucher per user per Sydney day.
-- issueDailyVoucherService always sets "validTo" to the end of the Sydney day,
-- so ("userId", "validTo") identifies the user/day. Rows whose "validTo" falls
-- before 2026-10-09 (UTC) are left out so a store whose history already holds
-- a raced duplicate does not fail this migration. Prisma 7.3 cannot express a
-- partial index; schema.prisma documents it on model Voucher.
CREATE UNIQUE INDEX "Voucher_staff_daily_user_day_key"
  ON "Voucher" ("userId", "validTo")
  WHERE "kind" = 'staff-daily' AND "validTo" >= TIMESTAMP '2026-10-09 00:00:00';
