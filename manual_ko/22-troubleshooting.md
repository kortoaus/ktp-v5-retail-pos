# 문제 해결

> 자주 발생하는 문제와 해결 방법입니다.

---

## 연결 문제

| 문제 | 해결 |
|------|------|
| "Cannot reach server" | Server가 실행 중이고 두 기기가 같은 네트워크에 있는지 확인하세요. Server Setup에서 IP와 port를 확인하세요. |
| "Not Registered Terminal" | Terminal의 IP 주소가 server에 등록되지 않았습니다. Server의 terminal 관리에서 등록하세요. |
| 앱이 계속 로딩 중 | Server가 다운되었거나 접근 불가능합니다. Server 상태와 네트워크 연결을 확인하세요. |

---

## Shift 문제

| 문제 | 해결 |
|------|------|
| "Shift already opened" | 이 terminal에 이미 다른 shift가 열려 있습니다. 먼저 마감하세요. |
| "No open shift found" | 다른 세션에서 shift가 마감되었을 수 있습니다. Home으로 돌아가서 새 shift를 열어보세요. |
| Sale/Refund 버튼이 안 보임 | Shift가 열려 있지 않습니다. 먼저 shift를 열어야 합니다. |

---

## Sale 문제

| 문제 | 해결 |
|------|------|
| Barcode 스캔해도 상품이 추가되지 않음 | 시스템에 상품이 없거나 가격이 설정되지 않았습니다. Cloud sync 상태를 확인하세요. |
| "Invalid item" | 상품은 존재하지만 가격이 없거나 설정이 잘못되었습니다. |
| Server가 결제를 거부함 | Server가 합계를 검증하여 불일치를 발견했습니다. 보통 계산 오류입니다 — cart를 비우고 다시 시도하세요. |
| Credit surcharge가 잘못된 것 같음 | Store Settings에서 surcharge 비율을 확인하세요. Payment 화면이 열릴 때 비율이 새로고침됩니다. |

---

## Refund 문제

| 문제 | 해결 |
|------|------|
| "Only sale invoices can be refunded" | Refund invoice를 선택했습니다. 원본 sale만 refund할 수 있습니다. |
| "Already fully refunded" | 이 invoice의 모든 상품이 이전 거래에서 refund되었습니다. |
| "Exceeds remaining quantity" | 이전 부분 refund 후 남은 것보다 많은 수량을 refund하려고 합니다. |
| "Exceeds remaining cash/credit cap" | Refund 결제가 원래 해당 방식으로 지불한 금액을 초과합니다. |

---

## 인쇄 문제

| 문제 | 해결 |
|------|------|
| 영수증이 인쇄되지 않음 | 영수증 프린터가 시리얼 포트로 연결되어 있는지 확인하세요. 화면 하단의 Device Monitor를 확인하세요. |
| Z-report가 인쇄되지 않음 | Shift는 정상적으로 마감되었습니다. Shift ID로 찾아서 필요하면 재인쇄하세요. |
| 라벨 프린터를 찾을 수 없음 | ZPL 프린터가 연결되고 설정되어 있는지 확인하세요. |

---

## Cash Drawer

| 문제 | 해결 |
|------|------|
| 서랍이 열리지 않음 | 시리얼 포트 연결을 확인하세요. 서랍은 영수증 프린터의 kick-drawer 명령으로 작동합니다. |
| 서랍이 예기치 않게 열림 | 시스템이 cash sale 시 자동으로 서랍을 엽니다. 이는 정상입니다. |

---

## Sync 문제

| 문제 | 해결 |
|------|------|
| 상품이 오래됨 | **Sync** 버튼 (원형 화살표 아이콘)을 눌러 cloud에서 최신 데이터를 가져옵니다. |
| Sync 실패 | 인터넷 연결을 확인하세요. Server가 cloud API에 접근할 수 있어야 합니다. |

---

## 일반

| 문제 | 해결 |
|------|------|
| 화면이 반응하지 않는 느낌 | 빠른 연속 누르기를 피하세요 — 현재 작업이 완료될 때까지 기다리세요. |
| "Unauthorized" 또는 권한 오류 | 사용자 계정에 필요한 권한이 없습니다. Admin에게 scope 업데이트를 요청하세요. |
| 앱 충돌 또는 멈춤 | 앱을 닫고 다시 열어보세요. 지속되면 server 연결을 확인하세요. |
