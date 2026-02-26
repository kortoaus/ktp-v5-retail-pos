# Permissions Reference

> 각 permission scope가 허용하는 작업입니다.

---

## 권한 작동 방식

각 사용자에게 **scopes** 목록이 있습니다 — 접근 가능한 기능을 제어하는 권한 태그입니다. 제한된 작업을 시도하면 시스템이 로그인한 사용자에게 필요한 scope가 있는지 확인합니다.

**admin** scope는 특별합니다 — **모든 권한 확인을 우회**합니다. Admin은 모든 것을 할 수 있습니다.

---

## Scope 목록

| Scope | 허용하는 작업 |
|-------|--------------|
| **admin** | 모든 기능에 대한 전체 접근. 다른 모든 scope 확인을 우회. |
| **interface** | 인터페이스/디스플레이 설정 접근 |
| **user** | 사용자 계정 생성, 편집, archive |
| **hotkey** | Hotkey 그룹과 버튼 생성, 편집, 삭제 |
| **refund** | Sale invoice에 대한 refund 처리 |
| **cashio** | Cash in/out 기록 생성 |
| **store** | Store settings 편집 (이름, 주소, surcharge 비율 등) |
| **shift** | Shift 시작 및 마감 |

---

## 화면별 권한 확인

| 화면 / 작업 | 필요한 Scope |
|-------------|-------------|
| Open Shift | shift |
| Close Shift | shift |
| Cash In / Out | cashio |
| Refund 처리 | refund |
| User Management | user |
| Hotkey Manager | hotkey |
| Store Settings | store |
| Sale | _(scope 불필요 — shift가 열려 있어야 함)_ |
| Invoice Search | _(scope 불필요)_ |
| Labeling | _(scope 불필요)_ |
| Server Setup | _(scope 불필요)_ |

---

## 권한 부여

권한은 [User Management](./17-user-management.md)에서 사용자 양식의 체크박스로 부여합니다. 한 사용자에게 여러 scope를 부여할 수 있습니다.

---

## 참고

- Scope가 **없는** 사용자는 제한 없는 기능 (sale, invoice search, labeling)만 사용할 수 있습니다
- Admin 사용자 (ID 1)는 부여된 scope에 관계없이 항상 전체 접근 권한을 가집니다
- Scope 확인은 **클라이언트** (화면 가드)와 **server** (미들웨어) 모두에서 이루어집니다 — 클라이언트를 우회하더라도 server가 권한 없는 요청을 거부합니다
