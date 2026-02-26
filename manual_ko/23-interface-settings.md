# Interface Settings

> 하드웨어 장치 설정 — 저울, 라벨 프린터, 영수증 프린터.

---

## 접근 방법

Home 화면에서 **Interface Settings**를 누릅니다. **interface** 권한이 필요합니다.

---

## 이 설정이 구성하는 것

이 화면에서는 이 terminal에 연결된 하드웨어 장치를 관리합니다. 설정은 `app-config.json`에 terminal별로 로컬 저장됩니다.

---

## 섹션

### Scale

시리얼 포트로 연결된 저울을 설정합니다.

| 필드 | 설명 |
|------|------|
| Enabled | 저울 켜기/끄기 토글 |
| Type | **CAS** (PD-II 단독 저울) 또는 **Datalogic** (저울 + 스캐너 결합형) |
| Serial Port | 감지된 포트에서 선택 (**Refresh Ports**로 재검색) |
| Baud Rate | 통신 속도 (기본값: 9600) |
| Data Bits | 바이트당 데이터 비트 (기본값: CAS의 경우 7) |
| Stop Bits | 정지 비트 (기본값: 1) |
| Parity | 패리티 검사 (기본값: CAS의 경우 even) |

### Label Printer (Serial)

시리얼 포트로 연결된 라벨 프린터를 설정합니다.

| 필드 | 설명 |
|------|------|
| Enabled | 켜기/끄기 토글 |
| Language | **ZPL** 또는 **SLCS** (Bixolon) |
| Serial Port | 감지된 포트에서 선택 |

### Label Printers (Network)

네트워크를 통한 라벨 프린터를 하나 이상 설정합니다. **+ Add**를 눌러 항목을 추가합니다.

| 필드 | 설명 |
|------|------|
| Language | ZPL 또는 SLCS |
| Name | 이 프린터의 표시 이름 |
| Host | IP 주소 |
| Port | 네트워크 포트 (기본값: 9100) |

**Remove**를 눌러 항목을 삭제합니다.

### ESC/POS Printer

영수증 프린터를 설정합니다 (sale/refund/Z-report 영수증용 감열 프린터).

| 필드 | 설명 |
|------|------|
| Enabled | 켜기/끄기 토글 |
| Host | 영수증 프린터의 IP 주소 |
| Port | 네트워크 포트 (기본값: 9100) |

Cash drawer는 이 프린터의 kick-drawer 명령을 통해 작동합니다.

---

## 저장

하단의 **Save**를 누릅니다. "Saved" 확인 메시지가 잠시 표시됩니다. 앱이 **재시작되지 않습니다** — 장치 연결은 관련 화면을 다시 열거나 앱을 재시작해야 적용될 수 있습니다.

---

## Refresh Ports

상단 바에서 **Refresh Ports**를 눌러 사용 가능한 시리얼 포트를 재검색합니다. 새 USB-시리얼 장치를 연결한 직후에 사용하세요.
