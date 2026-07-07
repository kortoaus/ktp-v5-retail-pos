# Pickup Order Phone Reveal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an explicit reveal button in the pickup order detail modal that temporarily displays the customer's full phone number by asking CRM to decrypt `Member.phone_e164_enc` through `PickupOrderCache.memberId`.

**Architecture:** CRM owns decryption and exposes a device-authenticated member phone endpoint. The retail POS server exposes a sale-scope local proxy that looks up the cached pickup order by CRM order id, forwards only the member id to CRM, and returns the phone without storing it. The renderer keeps the revealed phone only in `PickupOrderViewer` state and replaces the current `MEMBER ID` / `LEVEL` row with the reveal control.

**Tech Stack:** Express 5, TypeScript strict mode, Prisma 7 generated clients, Node built-in test runner, Axios, Electron 40, React 19, Tailwind CSS.

---

## Scope

This plan implements `/Users/dev/ktpv5/ktpv5-pos-retail/docs/superpowers/specs/2026-07-07-pickup-order-phone-reveal-design.md`.

In scope:

- CRM `POST /device/member/phone`.
- CRM service tests for scoped lookup, not-found, missing id, and decrypt failure.
- POS local `GET /api/pickup-order/:id/member-phone`.
- POS helper tests for local order lookup and CRM failure mapping.
- Renderer service for the local proxy.
- Pickup detail modal UI change: remove `MEMBER ID` and `LEVEL`, add reveal/hide/retry control.
- Build/test verification.

Out of scope:

- Persisting full phone numbers.
- Showing full phone numbers on work-order label preview.
- Printing full phone numbers.
- Changing pickup order sync payloads.
- Changing CRM schema.

Repository rule: do not stage or commit unless the user explicitly asks. The checkpoint steps below are review checkpoints, not git commits.

---

## File Structure

### CRM Server

- Modify `/Users/dev/ktpv5/ktpv5-crm-server/src/device/member/member.service.ts`
  - Add `getMemberPhoneById(companyId, memberId, deps?)`.
  - Keep dependency injection narrow so the new service can be tested without a real database.
- Modify `/Users/dev/ktpv5/ktpv5-crm-server/src/device/member/member.controller.ts`
  - Add `getMemberPhoneController`.
  - Map `HttpException` to the existing `{ ok, msg, result }` envelope.
- Modify `/Users/dev/ktpv5/ktpv5-crm-server/src/device/member/member.routes.ts`
  - Add `POST /phone`.
- Create `/Users/dev/ktpv5/ktpv5-crm-server/src/libs/memberPhoneReveal.test.ts`
  - Tests the CRM service function.

### Retail POS Server

- Create `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/pickup-order/pickup-order.member-phone.ts`
  - Focused local proxy helper for cached order lookup and CRM response mapping.
- Create `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/pickup-order/pickup-order.member-phone.test.ts`
  - Tests helper behavior with fake dependencies.
- Modify `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/pickup-order/pickup-order.controller.ts`
  - Add `getPickupOrderMemberPhoneController`.
- Modify `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/pickup-order/pickup-order.router.ts`
  - Add sale-scope-protected `GET /:id/member-phone` before `GET /:id`.

### Retail POS App

- Modify `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/service/pickup-order.service.ts`
  - Add reveal response type and `getPickupOrderMemberPhone(crmOrderId)`.
- Modify `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/components/pickupOrders/PickupOrderViewer.tsx`
  - Add transient reveal state and reveal control.
  - Remove `MEMBER ID` and `LEVEL` summary fields.

---

## Task 1: CRM Member Phone Service

**Files:**
- Create: `/Users/dev/ktpv5/ktpv5-crm-server/src/libs/memberPhoneReveal.test.ts`
- Modify: `/Users/dev/ktpv5/ktpv5-crm-server/src/device/member/member.service.ts`

- [ ] **Step 1: Write the failing CRM service tests**

Add `/Users/dev/ktpv5/ktpv5-crm-server/src/libs/memberPhoneReveal.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  BadRequestException,
  InternalServerException,
  NotFoundException,
} from "./exceptions";
import { getMemberPhoneById } from "../device/member/member.service";

test("getMemberPhoneById returns a decrypted scoped member phone", async () => {
  const calls: unknown[] = [];
  const result = await getMemberPhoneById(1, " member-1 ", {
    client: {
      member: {
        async findFirst(args) {
          calls.push(args);
          return {
            id: "member-1",
            phone_e164_enc: "encrypted-phone",
            phone_last4: "6789",
          };
        },
      },
    },
    decrypt(encryptedText) {
      return encryptedText === "encrypted-phone" ? "+614123456789" : null;
    },
  });

  assert.deepEqual(calls[0], {
    where: { companyId: 1, id: "member-1", archived: false },
    select: { id: true, phone_e164_enc: true, phone_last4: true },
  });
  assert.deepEqual(result, {
    ok: true,
    msg: "Member phone loaded",
    result: {
      memberId: "member-1",
      phone: "+614123456789",
      phoneLast4: "6789",
    },
    paging: null,
  });
});

test("getMemberPhoneById rejects blank member ids", async () => {
  await assert.rejects(
    () =>
      getMemberPhoneById(1, "   ", {
        client: {
          member: {
            async findFirst() {
              assert.fail("blank member id should not query");
            },
          },
        },
        decrypt() {
          assert.fail("blank member id should not decrypt");
        },
      }),
    BadRequestException,
  );
});

test("getMemberPhoneById rejects members outside the scoped company", async () => {
  await assert.rejects(
    () =>
      getMemberPhoneById(1, "member-404", {
        client: {
          member: {
            async findFirst() {
              return null;
            },
          },
        },
        decrypt() {
          assert.fail("missing member should not decrypt");
        },
      }),
    NotFoundException,
  );
});

test("getMemberPhoneById rejects undecryptable phone values", async () => {
  await assert.rejects(
    () =>
      getMemberPhoneById(1, "member-1", {
        client: {
          member: {
            async findFirst() {
              return {
                id: "member-1",
                phone_e164_enc: "corrupt",
                phone_last4: "6789",
              };
            },
          },
        },
        decrypt() {
          return null;
        },
      }),
    InternalServerException,
  );
});
```

- [ ] **Step 2: Run the CRM tests and verify they fail**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-crm-server
npm test
```

Expected: build fails because `getMemberPhoneById` is not exported from `src/device/member/member.service.ts`.

- [ ] **Step 3: Implement the CRM service**

In `/Users/dev/ktpv5/ktpv5-crm-server/src/device/member/member.service.ts`, update the imports:

```ts
import db from "../../libs/db";
import { decryptPhone, encryptPhone } from "../../libs/encryption";
import {
  BadRequestException,
  InternalServerException,
  NotFoundException,
} from "../../libs/exceptions";
import { hashPhone } from "../../libs/hasing";
import { buildMemberKeywordSearchWhere } from "../../libs/memberKeywordSearch";
import { buildPaging, type FindManyBody } from "../../libs/pagination";
```

Add these types and function near the existing member lookup helpers:

```ts
type MemberPhoneRow = {
  id: string;
  phone_e164_enc: string;
  phone_last4: string | null;
};

type MemberPhoneLookupClient = {
  member: {
    findFirst(args: {
      where: { companyId: number; id: string; archived: false };
      select: { id: true; phone_e164_enc: true; phone_last4: true };
    }): Promise<MemberPhoneRow | null>;
  };
};

type MemberPhoneLookupDeps = {
  client: MemberPhoneLookupClient;
  decrypt: (encryptedText: string) => string | null;
};

const defaultMemberPhoneLookupDeps: MemberPhoneLookupDeps = {
  client: db,
  decrypt: decryptPhone,
};

export const getMemberPhoneById = async (
  companyId: number,
  memberId: string,
  deps: MemberPhoneLookupDeps = defaultMemberPhoneLookupDeps,
) => {
  const normalizedMemberId = memberId.trim();
  if (!normalizedMemberId) {
    throw new BadRequestException("Member ID is required");
  }

  const member = await deps.client.member.findFirst({
    where: {
      companyId,
      id: normalizedMemberId,
      archived: false,
    },
    select: {
      id: true,
      phone_e164_enc: true,
      phone_last4: true,
    },
  });

  if (!member) {
    throw new NotFoundException("Member not found");
  }

  const phone = deps.decrypt(member.phone_e164_enc);
  if (!phone) {
    throw new InternalServerException("Member phone could not be decrypted");
  }

  return {
    ok: true,
    msg: "Member phone loaded",
    result: {
      memberId: member.id,
      phone,
      phoneLast4: member.phone_last4,
    },
    paging: null,
  };
};
```

- [ ] **Step 4: Run the CRM tests and verify they pass**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-crm-server
npm test
```

Expected: `memberPhoneReveal.test` passes and the existing CRM tests still pass.

---

## Task 2: CRM Device Endpoint

**Files:**
- Modify: `/Users/dev/ktpv5/ktpv5-crm-server/src/device/member/member.controller.ts`
- Modify: `/Users/dev/ktpv5/ktpv5-crm-server/src/device/member/member.routes.ts`

- [ ] **Step 1: Add the CRM controller**

In `/Users/dev/ktpv5/ktpv5-crm-server/src/device/member/member.controller.ts`, update the imports:

```ts
import {
  getMemberById,
  getMemberPhoneById,
  searchMemberByPhone,
  searchMembersByKeyword,
} from "./member.service";
```

Add this controller after `getMemberByIdController`:

```ts
export async function getMemberPhoneController(req: Request, res: Response) {
  try {
    const companyId = res.locals.companyId;
    if (!companyId) {
      res
        .status(401)
        .json({ ok: false, msg: "Company not found", result: null });
      return;
    }

    const memberId =
      typeof req.body?.memberId === "string" ? req.body.memberId : "";
    const result = await getMemberPhoneById(companyId, memberId);
    res.status(200).json(result);
    return;
  } catch (e) {
    if (e instanceof HttpException) {
      res.status(e.statusCode).json({
        ok: false,
        msg: e.message,
        result: null,
        paging: null,
      });
      return;
    }
    console.error(e);
    res
      .status(500)
      .json({ ok: false, msg: "Internal server error", result: null });
    return;
  }
}
```

- [ ] **Step 2: Register the CRM route**

In `/Users/dev/ktpv5/ktpv5-crm-server/src/device/member/member.routes.ts`, add the import:

```ts
  getMemberPhoneController,
```

Then add the route before the search routes:

```ts
memberRouter.route("/phone").post(getMemberPhoneController);
```

The final member route block should include:

```ts
memberRouter.use(deviceMiddleware);
memberRouter.route("/create").post(createMemberController);
memberRouter.route("/signup/stage").post(stageMemberSignupController);
memberRouter.route("/signup/request-otp").post(requestMemberSignupOtpController);
memberRouter.route("/signup/verify").post(verifyMemberSignupController);
memberRouter.route("/phone").post(getMemberPhoneController);
memberRouter.route("/search/phone").post(searchMemberController);
memberRouter.route("/search/keyword").post(searchMembersByKeywordController);
memberRouter.route("/search/id").post(getMemberByIdController);
```

- [ ] **Step 3: Verify CRM build and tests**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-crm-server
npm test
```

Expected: TypeScript build succeeds and all CRM tests pass.

---

## Task 3: POS Local Member Phone Proxy Helper

**Files:**
- Create: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/pickup-order/pickup-order.member-phone.test.ts`
- Create: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/pickup-order/pickup-order.member-phone.ts`

- [ ] **Step 1: Write the failing POS helper tests**

Add `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/pickup-order/pickup-order.member-phone.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  InternalServerException,
  NotFoundException,
  UnauthorizedException,
} from "../../libs/exceptions";
import { getPickupOrderMemberPhoneByCrmOrderId } from "./pickup-order.member-phone";

test("getPickupOrderMemberPhoneByCrmOrderId looks up the cached member id and returns CRM phone", async () => {
  const requestedMemberIds: string[] = [];
  const result = await getPickupOrderMemberPhoneByCrmOrderId(7, {
    async findOrderMemberId(crmOrderId) {
      assert.equal(crmOrderId, 7);
      return { memberId: "member-1" };
    },
    async requestCrmPhone(memberId) {
      requestedMemberIds.push(memberId);
      return {
        ok: true,
        status: 200,
        msg: "Member phone loaded",
        result: {
          memberId,
          phone: "+614123456789",
          phoneLast4: "6789",
        },
        paging: null,
      };
    },
  });

  assert.deepEqual(requestedMemberIds, ["member-1"]);
  assert.deepEqual(result, {
    ok: true,
    msg: "Member phone loaded",
    result: {
      memberId: "member-1",
      phone: "+614123456789",
      phoneLast4: "6789",
    },
    paging: null,
  });
});

test("getPickupOrderMemberPhoneByCrmOrderId rejects missing cached orders", async () => {
  await assert.rejects(
    () =>
      getPickupOrderMemberPhoneByCrmOrderId(404, {
        async findOrderMemberId() {
          return null;
        },
        async requestCrmPhone() {
          assert.fail("missing local order should not call CRM");
        },
      }),
    NotFoundException,
  );
});

test("getPickupOrderMemberPhoneByCrmOrderId maps CRM auth failures", async () => {
  await assert.rejects(
    () =>
      getPickupOrderMemberPhoneByCrmOrderId(7, {
        async findOrderMemberId() {
          return { memberId: "member-1" };
        },
        async requestCrmPhone() {
          return {
            ok: false,
            status: 401,
            msg: "Unauthorized",
            result: null,
            paging: null,
          };
        },
      }),
    UnauthorizedException,
  );
});

test("getPickupOrderMemberPhoneByCrmOrderId hides CRM network failures behind a generic message", async () => {
  await assert.rejects(
    () =>
      getPickupOrderMemberPhoneByCrmOrderId(7, {
        async findOrderMemberId() {
          return { memberId: "member-1" };
        },
        async requestCrmPhone() {
          return {
            ok: false,
            status: 0,
            msg: "Network Error",
            result: null,
            paging: null,
          };
        },
      }),
    (error) =>
      error instanceof InternalServerException &&
      error.message === "CRM member phone service unavailable",
  );
});
```

- [ ] **Step 2: Run the POS helper tests and verify they fail**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server
npm run build && node --test dist/v1/pickup-order/pickup-order.member-phone.test.js
```

Expected: build fails because `pickup-order.member-phone.ts` does not exist.

- [ ] **Step 3: Implement the POS helper**

Add `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/pickup-order/pickup-order.member-phone.ts`:

```ts
import type { ApiResponse } from "../../libs/cloud.api";
import { crmApiService } from "../../libs/cloud.api";
import db from "../../libs/db";
import {
  BadRequestException,
  HttpException,
  InternalServerException,
  NotFoundException,
  UnauthorizedException,
} from "../../libs/exceptions";

export type PickupOrderMemberPhone = {
  memberId: string;
  phone: string;
  phoneLast4: string | null;
};

type PickupOrderMemberIdRow = {
  memberId: string;
};

type PickupOrderMemberPhoneDeps = {
  findOrderMemberId: (
    crmOrderId: number,
  ) => Promise<PickupOrderMemberIdRow | null>;
  requestCrmPhone: (
    memberId: string,
  ) => Promise<ApiResponse<PickupOrderMemberPhone>>;
};

const defaultDeps: PickupOrderMemberPhoneDeps = {
  findOrderMemberId(crmOrderId) {
    return db.pickupOrderCache.findUnique({
      where: { crmOrderId },
      select: { memberId: true },
    });
  },
  requestCrmPhone(memberId) {
    return crmApiService.post<PickupOrderMemberPhone>("/device/member/phone", {
      memberId,
    });
  },
};

function requireCrmPhoneOk(
  res: ApiResponse<PickupOrderMemberPhone>,
): PickupOrderMemberPhone {
  if (res.ok && res.result != null) return res.result;

  const msg = res.msg || "CRM member phone request failed";
  if (res.status === 400) throw new BadRequestException(msg);
  if (res.status === 404) throw new NotFoundException(msg);
  if (res.status === 401 || res.status === 403) {
    throw new UnauthorizedException(msg);
  }
  if (res.status === 0 || (res.status && res.status >= 500)) {
    throw new InternalServerException("CRM member phone service unavailable");
  }
  throw new HttpException(res.status ?? 502, msg);
}

export async function getPickupOrderMemberPhoneByCrmOrderId(
  crmOrderId: number,
  deps: PickupOrderMemberPhoneDeps = defaultDeps,
) {
  const order = await deps.findOrderMemberId(crmOrderId);
  if (!order) throw new NotFoundException("Pickup order not found");

  const result = requireCrmPhoneOk(await deps.requestCrmPhone(order.memberId));
  return {
    ok: true,
    msg: "Member phone loaded",
    result,
    paging: null,
  };
}
```

- [ ] **Step 4: Run the POS helper tests and verify they pass**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server
npm run build && node --test dist/v1/pickup-order/pickup-order.member-phone.test.js
```

Expected: TypeScript build succeeds and the new helper tests pass.

---

## Task 4: POS Local Route

**Files:**
- Modify: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/pickup-order/pickup-order.controller.ts`
- Modify: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/pickup-order/pickup-order.router.ts`

- [ ] **Step 1: Add the POS controller**

In `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/pickup-order/pickup-order.controller.ts`, add this import:

```ts
import { HttpException } from "../../libs/exceptions";
import { getPickupOrderMemberPhoneByCrmOrderId } from "./pickup-order.member-phone";
```

Add this controller:

```ts
export async function getPickupOrderMemberPhoneController(
  req: Request,
  res: Response,
) {
  try {
    const crmOrderId = parseIntId(req, "id");
    const result = await getPickupOrderMemberPhoneByCrmOrderId(crmOrderId);
    res.status(200).json(result);
  } catch (error) {
    if (error instanceof HttpException) {
      res.status(error.statusCode).json({
        ok: false,
        msg: error.message,
        result: null,
        paging: null,
      });
      return;
    }
    console.error(error);
    res.status(500).json({
      ok: false,
      msg: "Internal server error",
      result: null,
      paging: null,
    });
  }
}
```

- [ ] **Step 2: Add the sale-scope route**

In `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/pickup-order/pickup-order.router.ts`, add `getPickupOrderMemberPhoneController` to the controller import.

Add this route before `pickupOrderRouter.get("/:id", ...)`:

```ts
pickupOrderRouter.get(
  "/:id/member-phone",
  userMiddleware,
  scopeMiddleware("sale"),
  getPickupOrderMemberPhoneController,
);
```

- [ ] **Step 3: Verify POS server build and helper tests**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server
npm run build && node --test dist/v1/pickup-order/pickup-order.member-phone.test.js
```

Expected: TypeScript build succeeds and the helper tests pass.

---

## Task 5: Renderer Service

**Files:**
- Modify: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/service/pickup-order.service.ts`

- [ ] **Step 1: Add the phone reveal type and service function**

In `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/service/pickup-order.service.ts`, add this type after the imports:

```ts
export type PickupOrderMemberPhone = {
  memberId: string;
  phone: string;
  phoneLast4: string | null;
};
```

Add this function after `getPickupOrderByCrmId`:

```ts
export async function getPickupOrderMemberPhone(
  crmOrderId: number,
): Promise<ApiResponse<PickupOrderMemberPhone>> {
  return apiService.get<PickupOrderMemberPhone>(
    `/api/pickup-order/${crmOrderId}/member-phone`,
  );
}
```

- [ ] **Step 2: Verify the renderer service compiles**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app
npm run build
```

Expected: Electron app build succeeds.

---

## Task 6: Pickup Detail Reveal UI

**Files:**
- Modify: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/components/pickupOrders/PickupOrderViewer.tsx`

- [ ] **Step 1: Import the reveal service**

Update the service import:

```ts
import {
  getPickupOrderByCrmId,
  getPickupOrderMemberPhone,
} from "../../service/pickup-order.service";
```

- [ ] **Step 2: Add transient reveal state and reset it on order changes**

Inside `PickupOrderViewer`, add these state values after `error`:

```ts
  const [revealedPhone, setRevealedPhone] = useState("");
  const [phoneLoading, setPhoneLoading] = useState(false);
  const [phoneError, setPhoneError] = useState("");
```

Inside the existing `useEffect`, immediately after `setError("");`, add:

```ts
    setRevealedPhone("");
    setPhoneLoading(false);
    setPhoneError("");
```

- [ ] **Step 3: Add the reveal handler**

Inside `PickupOrderViewer`, after the `useEffect`, add:

```ts
  const revealPhone = async () => {
    if (crmOrderId == null || phoneLoading) return;

    setPhoneLoading(true);
    setPhoneError("");
    const res = await getPickupOrderMemberPhone(crmOrderId);
    if (res.ok && res.result) {
      setRevealedPhone(res.result.phone);
    } else {
      setPhoneError(res.msg || "Could not load phone");
    }
    setPhoneLoading(false);
  };

  const hidePhone = () => {
    setRevealedPhone("");
    setPhoneError("");
  };
```

- [ ] **Step 4: Pass reveal state into `OrderSummary`**

Replace:

```tsx
              <OrderSummary order={order} />
```

with:

```tsx
              <OrderSummary
                order={order}
                revealedPhone={revealedPhone}
                phoneLoading={phoneLoading}
                phoneError={phoneError}
                onRevealPhone={revealPhone}
                onHidePhone={hidePhone}
              />
```

- [ ] **Step 5: Update `OrderSummary` props and remove `MEMBER ID` / `LEVEL`**

Replace the `OrderSummary` function signature and summary grid with:

```tsx
function OrderSummary({
  order,
  revealedPhone,
  phoneLoading,
  phoneError,
  onRevealPhone,
  onHidePhone,
}: {
  order: PickupOrderDetail;
  revealedPhone: string;
  phoneLoading: boolean;
  phoneError: string;
  onRevealPhone: () => void;
  onHidePhone: () => void;
}) {
  return (
    <div className="border-b border-gray-200 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-mono text-sm font-bold">
            {order.documentId}
          </div>
          <div className="mt-1 text-xs text-gray-500">
            CRM Order {order.crmOrderId}
          </div>
        </div>
        <StatusBadge status={order.status} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
        <SummaryField
          label="Pickup"
          value={formatPickupTime(order.pickupStartsAt)}
        />
        <SummaryField
          label="Created"
          value={formatPickupTime(order.crmCreatedAt)}
        />
        <SummaryField label="Member" value={order.memberName || "-"} />
        <SummaryField
          label="Phone"
          value={order.memberPhoneLast4 ? `*${order.memberPhoneLast4}` : "-"}
        />
        <PhoneRevealControl
          phone={revealedPhone}
          loading={phoneLoading}
          error={phoneError}
          onReveal={onRevealPhone}
          onHide={onHidePhone}
        />
        <SummaryField
          label="Subtotal"
          value={formatPickupMoney(order.linesTotal)}
        />
        <SummaryField label="Total" value={formatPickupMoney(order.total)} />
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Add `PhoneRevealControl`**

Add this component after `SummaryField`:

```tsx
function PhoneRevealControl({
  phone,
  loading,
  error,
  onReveal,
  onHide,
}: {
  phone: string;
  loading: boolean;
  error: string;
  onReveal: () => void;
  onHide: () => void;
}) {
  const hasPhone = phone.length > 0;

  return (
    <div className="col-span-2 min-w-0 rounded-md border border-gray-200 bg-gray-50 p-3">
      <div className="flex min-h-9 items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="font-bold uppercase tracking-wide text-gray-400">
            Full phone
          </div>
          <div
            className={cn(
              "mt-0.5 truncate font-medium text-gray-800",
              hasPhone && "font-mono",
              error && "text-red-600",
            )}
          >
            {loading
              ? "Loading phone..."
              : error || (hasPhone ? phone : "Hidden")}
          </div>
        </div>
        {hasPhone ? (
          <button
            type="button"
            onPointerDown={onHide}
            className="shrink-0 rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-bold text-gray-700 active:bg-gray-200"
          >
            Hide
          </button>
        ) : (
          <button
            type="button"
            onPointerDown={onReveal}
            disabled={loading}
            className="shrink-0 rounded-md bg-blue-600 px-3 py-2 text-xs font-bold text-white active:bg-blue-700 disabled:bg-gray-300"
          >
            {error ? "Try Again" : "Show Full Phone"}
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Verify `MEMBER ID` and `LEVEL` are gone from the viewer**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail
rg -n 'Member ID|label="Level"|MEMBER ID|LEVEL' retail_pos_app/src/renderer/src/components/pickupOrders/PickupOrderViewer.tsx
```

Expected: no matches for `Member ID` or `label="Level"` in `PickupOrderViewer.tsx`.

- [ ] **Step 8: Verify renderer build**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app
npm run build
```

Expected: Electron app build succeeds.

---

## Task 7: Full Verification

**Files:**
- No source changes.

- [ ] **Step 1: Run CRM validation**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-crm-server
npm test
```

Expected: TypeScript build succeeds and all CRM tests pass.

- [ ] **Step 2: Run POS server validation**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server
npm run build && node --test dist/v1/pickup-order/pickup-order.member-phone.test.js
```

Expected: TypeScript build succeeds and the new POS helper tests pass.

- [ ] **Step 3: Run POS app validation**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app
npm run build
```

Expected: Electron app build succeeds.

- [ ] **Step 4: Manual UI check**

With the POS app and local server running:

1. Open `/manager/pickup-orders`.
2. Open a pickup order detail modal.
3. Confirm the left summary shows masked `PHONE`.
4. Confirm `MEMBER ID` and `LEVEL` are not visible.
5. Press `Show Full Phone`.
6. Confirm the full phone appears in the reveal control.
7. Press `Hide`.
8. Confirm the phone returns to `Hidden`.
9. Close and reopen the modal.
10. Confirm the full phone is hidden again.
11. Confirm the work-order label preview still shows only the masked `*last4` phone.

---

## Self-Review Notes

- Spec coverage:
  - CRM decrypt endpoint: Task 1 and Task 2.
  - `PickupOrderCache.memberId` lookup: Task 3 and Task 4.
  - Renderer transient display: Task 5 and Task 6.
  - UI placement replacing `MEMBER ID` / `LEVEL`: Task 6.
  - No persistence/printing: Task 3 uses direct proxy response only; Task 6 keeps local component state only.
- Type consistency:
  - CRM response uses `memberId`, `phone`, and `phoneLast4`.
  - POS proxy and renderer service use the same property names.
  - Route id remains CRM order id.
- Placeholder scan:
  - No incomplete requirement sections.
  - No deferred implementation steps.
  - Every code-changing step includes concrete code.
