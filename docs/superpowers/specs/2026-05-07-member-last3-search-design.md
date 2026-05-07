# Member Last-3 Search Design

## Summary

Improve POS member lookup so cashiers search by the customer's last 3 phone
digits only. The POS search modal must no longer ask for, validate, or send a
full phone number for member lookup.

The feature crosses:

- `retail_pos_app`: member search UI and renderer CRM service.
- `retail_pos_server`: local CRM proxy endpoint.
- `/Users/dev/ktpv5/ktpv5-crm-server`: device member search endpoint backed by
  `Member.phone_last4`.

## Goals

- Let cashiers identify app-less or elderly customers without requiring QR scan.
- Reduce staff exposure to full customer phone numbers.
- Return a selectable list when multiple members share the same 3-digit suffix.
- Keep QR/member-ID lookup unchanged because it does not expose phone digits.

## Non-Goals

- Rename `phone_last4` in this change. The field currently stores 3 digits even
  though the name says 4.
- Add full phone lookup fallback in the POS modal.
- Show full phone numbers anywhere in the search results.
- Add pagination to the modal result list.

## API Design

### CRM Server

Add a device route:

```text
POST /device/member/search/phone-last4
```

Request:

```ts
{ phoneLast4: string }
```

Validation:

- `companyId` comes from `deviceMiddleware` locals.
- `phoneLast4` must be exactly 3 numeric digits.

Query:

- `Member.companyId = companyId`
- `Member.phone_last4 = phoneLast4`
- `Member.archived = false`
- order by `createdAt desc`
- limit 20

Response uses the existing envelope:

```ts
{ ok: true, msg: "Members found", result: Member[] }
```

If there are no matches, return `ok: true` with `result: []`. Reserve `ok:
false` for validation or server failures.

### POS Local Server

Add a proxy route:

```text
POST /api/crm/member/search/phone-last4
```

It forwards the body to CRM server `/device/member/search/phone-last4` through
the existing `crmApiService`.

### POS Renderer Service

Add:

```ts
searchMembersByPhoneLast4(phoneLast4: string): Promise<ApiResponse<Member[]>>
```

The existing `searchMemberByPhone` function can remain for non-modal callers if
needed, but `MemberSearchModal` should stop using it.

## UI Design

`MemberSearchModal` Search tab becomes a last-3 lookup surface:

- Label/placeholder: "Last 3 digits"
- Numeric input only
- Input caps at 3 digits
- Search button enabled only when exactly 3 digits are present
- On-screen keyboard stays in numpad layout
- Search results show a tap-friendly list:
  - member name
  - masked suffix as `***123`
  - level
- Tapping a result selects that member immediately through `onSelect(member)`.

State changes:

- Replace the single `foundMember` state with `foundMembers: Member[]`.
- Clear prior results before each search.
- Treat an empty successful result as "Member not found".

## Privacy Rules

- The modal must not display or request a full phone number in search mode.
- The modal must not call the full-phone search endpoint.
- Result display is limited to name, `phone_last4`, and level.

## Error Handling

- Less or more than 3 digits: block search and show "Enter last 3 digits".
- Empty result: "Member not found".
- CRM validation failure: show returned `msg`.
- Network/proxy failure: "Network error".

## Testing

Run compile checks for touched projects:

```bash
cd /Users/dev/ktpv5/ktpv5-crm-server && npm test
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server && npm run build
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app && npm run build
```

Manual POS QA:

- Search with fewer than 3 digits: button disabled or validation message.
- Search with 3 digits and no match: no member selected, "Member not found".
- Search with one match: row appears and selecting it attaches the member.
- Search with multiple matches: newest-first list appears; selecting one
  attaches the chosen member.
- Confirm the modal never shows or asks for a full phone number in search mode.
