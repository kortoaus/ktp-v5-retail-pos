# Server Setup

> Terminal을 POS server에 연결합니다.

---

## 이 설정의 역할

각 POS terminal은 중앙 server에 연결해야 합니다. Server에 모든 상품 데이터, sale 기록, 설정이 저장되어 있습니다. Server 연결 없이는 terminal을 사용할 수 없습니다.

---

## 순서

1. Home 화면에서 **Server Setup**을 누릅니다.
2. **Host** — server의 IP 주소를 입력합니다 (예: `192.168.1.100`).
3. **Port** — server의 포트 번호를 입력합니다 (기본값: `2200`).
4. **Connect**를 누릅니다.

시스템이 다음을 수행합니다:
- 연결 테스트 (5초 후 타임아웃)
- 성공 시 설정을 저장하고 **앱을 재시작**합니다
- 실패 시 오류 메시지를 표시합니다 — host와 port를 확인하세요

---

## 연결 후

연결이 완료되면 앱이 재시작되고 Home 화면이 표시됩니다. Terminal은 IP 주소로 식별되므로, 이 terminal이 server에 등록되어 있는지 확인하세요 ([Terminal & Users](./02-terminal-and-users.md) 참조).

---

## 문제 해결

| 문제 | 해결 |
|------|------|
| "Cannot reach server" | Server가 실행 중이고 두 기기가 같은 네트워크에 있는지 확인하세요 |
| 연결 타임아웃 | IP 주소와 port가 정확한지 확인하세요 |
| 앱이 재시작되지 않음 | 앱을 수동으로 닫고 다시 열어보세요 |
