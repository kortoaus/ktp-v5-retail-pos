# Store Settings

> 매장의 표시 정보, surcharge 비율, 영수증 하단 문구를 설정합니다.

---

## 이 설정이 제어하는 것

Store settings는 영수증에 표시되는 내용과 credit card surcharge 계산 방식을 정의합니다. 이 설정은 모든 terminal에서 공유됩니다.

---

## 접근 방법

1. Home 화면에서 **Store Settings**를 누릅니다.
2. 로그인이 필요합니다 (**store** 권한 필요).

---

## 필드

| 필드 | 설명 | 영수증 표시 |
|------|------|-------------|
| Store Name | 사업자 상호명 | 예 — 헤더 |
| Phone | 연락처 전화번호 | 예 — 헤더 |
| Address 1 | 도로명 주소 | 예 — 헤더 |
| Address 2 | 동/호 (선택) | 예 — 헤더 |
| Suburb | 시/구 | 예 — 헤더 |
| State | 주 약어 | 예 — 헤더 |
| Postcode | 우편번호 | 예 — 헤더 |
| Country | 국가명 | 아니오 |
| ABN | Australian Business Number | 예 — "TAX INVOICE - ABN ..." |
| Website | 사업자 웹사이트 (https:// 제외) | 예 — "https://..."로 인쇄 |
| Email | 연락처 이메일 | 아니오 |
| Credit Surcharge (%) | 카드 결제 surcharge 비율 | 결제 계산에 사용 |
| Receipt Footer | 영수증 하단에 인쇄되는 문구 | 예 — 합계 아래 |

---

## Credit Surcharge 비율

Credit card 결제에 적용되는 surcharge를 제어합니다.

- **퍼센트로 입력** — 예: 1.5%인 경우 `1.5` 입력
- 시스템은 내부적으로 소수로 저장합니다 (0.015)
- 비율은 각 credit card 결제 건에 적용됩니다: `surcharge = 금액 × 비율`
- 기본값은 1.5%

이 비율을 변경하면 이후 모든 sale에 즉시 적용됩니다. 과거 invoice는 영향받지 않습니다 — sale 시점의 surcharge가 저장되어 있습니다.

---

## 편집

1. 왼쪽에서 필드를 눌러 선택합니다.
2. 오른쪽의 키보드가 적절한 레이아웃으로 전환됩니다:
   - **Numpad** — phone, postcode, ABN, surcharge 비율용
   - **한국어 키보드** — store name, receipt footer용
   - **영어 키보드** — address, email, website용
3. 완료 후 **Save**를 누릅니다.

---

## 중요 사항

- Store settings는 **단일 레코드**입니다 — 모든 terminal이 같은 설정을 공유합니다
- 영수증 데이터는 **sale 시점에 스냅샷**됩니다 — 매장명을 변경해도 이전 영수증에는 이전 이름이 유지됩니다
- Surcharge 비율은 각 terminal에서 최신 값을 불러오므로 변경 사항이 즉시 적용됩니다
