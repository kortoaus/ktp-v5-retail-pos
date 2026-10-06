# Clear Cart On Sale Persist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clear the active sale cart as soon as the local API successfully records the sale, while keeping the completion overlay available for optional receipt printing regardless of tender type or change due.

**Architecture:** `PaymentModal` already stores a completed invoice snapshot in `completedInfo`, so the overlay can remain open after the cart store is cleared. The checkout success path should populate `completedInfo` and call `clearActiveCart()` immediately after `createSale` succeeds, before drawer/receipt-detail follow-up work, while `finishSale()` should only close the overlay/modal.

**Tech Stack:** React 19, Zustand, TypeScript, Electron Vite, existing POS sale/payment services.

---

### Task 1: Update Checkout Completion State Ownership

**Files:**
- Modify: `retail_pos_app/src/renderer/src/screens/SaleScreen/PaymentModal/index.tsx`

- [ ] **Step 1: Run the failing behavior check**

Run:

```bash
node -e 'const fs=require("fs"); const s=fs.readFileSync("retail_pos_app/src/renderer/src/screens/SaleScreen/PaymentModal/index.tsx","utf8"); const successPath=/setCompletedInfo\\(\\{[\\s\\S]*receiptPrinted: false,[\\s\\S]*\\}\\);\\s*clearActiveCart\\(\\);[\\s\\S]*if \\(cal\\.cashIntent > 0\\)[\\s\\S]*getSaleInvoiceById/.test(s); const finish=s.match(/function finishSale\\(\\) \\{([\\s\\S]*?)\\n  \\}/)?.[1] ?? ""; const finishDoesNotClear=finish.includes("setCompletedInfo(null);") && finish.includes("onCancel();") && !finish.includes("clearActiveCart();"); if(!successPath || !finishDoesNotClear){ console.error("RED: sale success does not clear cart immediately while Done only closes overlay"); process.exit(1); } console.log("GREEN: sale success clears cart immediately and Done only closes overlay");'
```

Expected: FAIL with `RED: sale success does not clear cart immediately while Done only closes overlay`.

- [ ] **Step 2: Change sale success path**

In `handleCompleteSale()`, immediately after `createSale` succeeds, set the completion snapshot and clear the cart before drawer/receipt follow-up:

```ts
setCompletedInfo({
  invoice: res.result,
  detail: null,
  total: cal.total,
  paid: cal.paid,
  cashReceived: cal.cashIntent,
  change: cal.change,
  receiptPrinted: false,
});
clearActiveCart();
```

This keeps the overlay visible because `completedInfo` is set, but clears the shared cart store immediately after the server records the invoice. Fetch receipt detail afterward and update `completedInfo.detail` when available.

- [ ] **Step 3: Change Done behavior**

In `finishSale()`, remove the cart clear call so it becomes:

```ts
function finishSale() {
  setCompletedInfo(null);
  onCancel();
}
```

The active cart is already cleared at persistence time; `Done` should only close the completion UI.

- [ ] **Step 4: Run the green behavior check**

Run the same `node -e` command from Step 1.

Expected: PASS with `GREEN: sale success clears cart immediately and Done only closes overlay`.

### Task 2: Align Manual QA Checklist

**Files:**
- Modify: `TEST_CHECKLIST.md`

- [ ] **Step 1: Update checkout completion expectations**

Replace the outdated completion bullets:

```md
  - [ ] 영수증 인쇄 (80mm thermal, `^#!` 범례, QR)
  - [ ] change > 0 면 ChangeOverlay (Open Drawer / Reprint / Done)
  - [ ] change = 0 면 자동 cart clear + modal close
```

With:

```md
  - [ ] API 성공 시 active cart 즉시 clear
  - [ ] 결제 tender / change 여부와 상관없이 완료 overlay 표시
  - [ ] overlay 에서 영수증 출력 선택 가능 (80mm thermal, `^#!` 범례, QR)
  - [ ] change > 0 면 ChangeOverlay 에 change / Open Drawer / Reprint / Done 표시
  - [ ] Done 은 overlay/modal close 만 수행 (cart 는 이미 clear)
```

- [ ] **Step 2: Verify no stale auto-close checklist remains**

Run:

```bash
rg -n "change = 0 면 자동 cart clear \\+ modal close" TEST_CHECKLIST.md
```

Expected: no match for the old `change = 0 면 자동 cart clear + modal close` expectation.

### Task 3: Build Verification

**Files:**
- No source edits.

- [ ] **Step 1: Build the Electron app**

Run:

```bash
npm run build
```

from `retail_pos_app/`.

Expected: `electron-vite build` exits 0 for main, preload, and renderer.

- [ ] **Step 2: Review final diff**

Run:

```bash
git diff -- retail_pos_app/src/renderer/src/screens/SaleScreen/PaymentModal/index.tsx TEST_CHECKLIST.md
```

Expected: only the sale-success clear timing and QA checklist text changed.
