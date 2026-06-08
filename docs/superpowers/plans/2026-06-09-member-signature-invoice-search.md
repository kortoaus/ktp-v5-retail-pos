# Member Signature Invoice Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Search Invoice and Refund scan `member%%%<memberId>` QR signatures to search invoices by member.

**Architecture:** Add a tiny renderer helper that classifies invoice-search scan payloads as receipt, member, or raw keyword. Reuse that helper in `SaleInvoiceSearchPanel`, the shared component behind both Search Invoice and Refund, so no server or route changes are needed.

**Tech Stack:** React 19 renderer, TypeScript, existing `useBarcodeScanner`, existing CRM `searchMemberById`, existing sale invoice list API.

---

### Task 1: Add Scan Payload Parser

**Files:**
- Create: `retail_pos_app/src/renderer/src/libs/invoice-search-scan.ts`
- Create: `retail_pos_app/scripts/tests/invoice-search-scan.test.ts`

- [ ] **Step 1: Write the failing parser test**

Create `retail_pos_app/scripts/tests/invoice-search-scan.test.ts` with:

```typescript
import assert from "node:assert/strict";
import { parseInvoiceSearchScan } from "../../src/renderer/src/libs/invoice-search-scan.ts";

assert.deepEqual(parseInvoiceSearchScan("receipt%%%INV-123"), {
  type: "receipt",
  serial: "INV-123",
});

assert.deepEqual(parseInvoiceSearchScan("member%%%crm-42"), {
  type: "member",
  memberId: "crm-42",
});

assert.deepEqual(parseInvoiceSearchScan("INV-999"), {
  type: "keyword",
  keyword: "INV-999",
});

console.log("invoice-search-scan tests passed");
```

- [ ] **Step 2: Run the parser test to verify it fails**

Run:

```bash
cd retail_pos_app && node scripts/tests/invoice-search-scan.test.ts
```

Expected: FAIL because `invoice-search-scan.ts` does not exist yet.

- [ ] **Step 3: Implement the parser helper**

Create `retail_pos_app/src/renderer/src/libs/invoice-search-scan.ts` with:

```typescript
export const RECEIPT_QR_PREFIX = "receipt%%%";
export const MEMBER_QR_PREFIX = "member%%%";

export type InvoiceSearchScan =
  | { type: "receipt"; serial: string }
  | { type: "member"; memberId: string }
  | { type: "keyword"; keyword: string };

export function parseInvoiceSearchScan(payload: string): InvoiceSearchScan {
  if (payload.startsWith(RECEIPT_QR_PREFIX)) {
    return {
      type: "receipt",
      serial: payload.slice(RECEIPT_QR_PREFIX.length),
    };
  }

  if (payload.startsWith(MEMBER_QR_PREFIX)) {
    return {
      type: "member",
      memberId: payload.slice(MEMBER_QR_PREFIX.length),
    };
  }

  return { type: "keyword", keyword: payload };
}
```

- [ ] **Step 4: Run the parser test to verify it passes**

Run:

```bash
cd retail_pos_app && node scripts/tests/invoice-search-scan.test.ts
```

Expected: PASS with `invoice-search-scan tests passed`.

### Task 2: Wire Member Signatures Into Invoice Search Panel

**Files:**
- Modify: `retail_pos_app/src/renderer/src/components/SaleInvoiceSearchPanel.tsx`

- [ ] **Step 1: Import the CRM lookup and scan parser**

Add imports:

```typescript
import { searchMemberById } from "../service/crm.service";
import { parseInvoiceSearchScan } from "../libs/invoice-search-scan";
```

- [ ] **Step 2: Replace local QR prefix parsing in `handleScan`**

Inside `handleScan`, call:

```typescript
const parsed = parseInvoiceSearchScan(barcode);
```

Use `parsed.type === "receipt"` and `parsed.type === "keyword"` for the existing keyword search behavior.

- [ ] **Step 3: Add the member branch before receipt keyword search**

For `parsed.type === "member"`:

```typescript
const memberRes = await searchMemberById(parsed.memberId);
if (!memberRes.ok || !memberRes.result) {
  window.alert(memberRes.msg || "Member not found");
  setItems([]);
  setPaging(null);
  return;
}

const selectedMember = {
  id: memberRes.result.id,
  name: memberRes.result.name,
  level: memberRes.result.level,
  points: memberRes.result.points,
  phone_last4: memberRes.result.phone_last4,
};

setKeyword("");
setFrom(null);
setTo(null);
setMember(selectedMember);
setMinTotalStr("");
setMaxTotalStr("");
if (!lockedTypeFilter) setTypeFilter("ALL");

const invoiceRes = await searchSaleInvoices({
  page: 1,
  limit: PAGE_SIZE,
  memberId: selectedMember.id,
  type: lockedTypeFilter,
});
```

Set `items` and `paging` from `invoiceRes`. Do not call `onSelect` for member scans.

- [ ] **Step 4: Preserve receipt QR auto-select**

For receipt and raw keyword scans, keep the existing behavior:

```typescript
if (res.ok && res.result) {
  setItems(res.result);
  setPaging(res.paging);
  if (res.result.length === 1) onSelect(res.result[0]);
}
```

### Task 3: Verify The Renderer

**Files:**
- Verify only.

- [ ] **Step 1: Run the parser test**

Run:

```bash
cd retail_pos_app && node scripts/tests/invoice-search-scan.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run the app build**

Run:

```bash
cd retail_pos_app && npm run build
```

Expected: PASS. This covers TypeScript and renderer bundling.

- [ ] **Step 3: Manual smoke checklist**

When the app is available, verify:

```text
Search Invoice + receipt QR: opens viewer when one invoice matches.
Search Invoice + member QR: filters list to that member; does not auto-open.
Refund + receipt QR: navigates to refund detail when one SALE invoice matches.
Refund + member QR: filters list to that member's SALE invoices only.
```
