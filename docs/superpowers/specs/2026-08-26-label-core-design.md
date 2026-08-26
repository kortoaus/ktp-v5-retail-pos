# label-core — ZPL 단일 라벨 라이브러리 뼈대 + /scale 테스트 페이지 (2026-08-26)

정본: BACKLOG §AC-11. 배경: Bixolon XD3/XD5(BPL-Z)도 Zebra 와 동일하게 `~DY` 로
Noto Sans KR TTF 를 플래시 주입해 `^CI28`+`^A@`+`^FH` 로 한글 출력 확인(오너
실물). **SLCS 지원 종료, ZPL 단일 언어.** 라벨 출력 지점 3곳(operations·pos·runner)의
5갈래 렌더링(LabelBuilder 커맨드 / DOM canvas 래스터 / Skia 래스터 / 손 ZPL /
SLCS 벡터)을 **순수 TS 라이브러리 1벌**로 대체한다.

진행 순서(오너): ① POS 에 **완전히 새 트랙**으로 코어 뼈대 → ② `/scale` 임시
테스트 페이지에서 템플릿 확정(실물 튜닝) → ③ runner·operations 이식 → ④ 테스트·
안정성 완료 후 레거시 삭제. **이 문서는 ①(+페이지 골격)만.** 레거시
(`label-builder.ts`, `label-templates.ts`, `label-7090-v2/`, `order-label-zpl.ts`,
`WeightLabelScreen`)는 **손대지 않는다.** `main/zpl-font/` 는 그대로 사용.

## 1. 위치·제약

`retail_pos_app/src/renderer/src/label-core/` — **DOM·Node·Electron API 사용 금지**
(나중에 `sync-sale-core` 방식으로 runner·operations 에 그대로 카피). 의존성 0.
테스트는 `node --test` (`*.test.mjs`, 기존 `--experimental-strip-types` 관례).

## 2. 모듈

```
label-core/
  media.ts     DPMM = 8 (203dpi) 상수 1개. MEDIA: Record<MediaId, {id, mm:[w,h], dots:[w,h], label}>
               MediaId = '6040' | '58100' | '7030' | '7090' | '100100'
               dots = mm×8 정확히(6040→480×320, 58100→464×800, 7030→560×240, 7090→560×720, 100100→800×800).
               레거시 440/550/812 값은 쓰지 않는다 — 템플릿 단계에서 실물로 재튜닝.
  fonts.ts     FONT = { M:'E:NOTOKRM.TTF', B:'E:NOTOKRB.TTF', BK:'E:NOTOKRBK.TTF' } (zpl-font/catalog 과 동일 문자열,
               단일 정본 주석). weight → 파일 매핑. builtin 폴백 = '0'(^A0N).
  model.ts     선언적 요소 모델(클래스 없음, 전부 정수 dots, 원점 좌상):
               Label { media: MediaId; elements: Element[]; copies?: number; dbg?: boolean }
               Element =
                 | Text  { kind:'text', x,y, text, size, weight?:'M'|'B'|'BK', font?:'noto'|'builtin',
                           width?, lines?, align?:'L'|'C'|'R', shrink?:boolean, minSize? }
                 | Line  { kind:'line', x,y, w,h, thick }         // ^GB 수평/수직
                 | Box   { kind:'box',  x,y, w,h, thick }
                 | Barcode { kind:'barcode', sym:'ean13'|'code128', x,y, h, module?, hri?:boolean, data }
                 | Qr    { kind:'qr', x,y, mag, ec?:'L'|'M'|'Q'|'H', data }
                 | DataMatrix { kind:'datamatrix', x,y, size, data }
               Strike 헬퍼: strike(x,y,w) → Line.
  measure.ts   문자 폭 근사(순수): 라틴 0.55em·숫자 0.58em·한글/CJK 1.0em·공백 0.3em. fitSize(text,width,size,minSize) →
               width 안에 들어가는 최대 size (shrink 용). 정확도는 근사 — ^FB 가 실제 줄바꿈을 맡고 shrink 는 안전마진.
  escape.ts    fieldData(text): ^FH 용 `_5E _7E _5F` 이스케이프 + C0 제어문자 제거. **비ASCII 보존**(한글 삭제 금지).
  zpl.ts       renderLabel(label): string. `^XA ^CI28 ^PW{w} ^LL{h} ^LH0,0` … `^XZ`
               text → `^FO x,y ^A@N,h,w,{FONT[weight]}` (builtin 이면 `^A0N,h,w`) [`^FB width,lines,0,align,0`] `^FH ^FD{escaped}^FS`
               w = round(h × 0.9) 기본(폭 비율 상수 1개). shrink 면 measure.fitSize 로 h 조정.
               line/box → `^FO ^GB w,h,thick ^FS`; ean13 → `^BY module,3,h ^BEN,h,{Y|N},N`(12자리 입력, 체크디짓 프린터);
               code128 → `^BY ^BCN,h,{Y|N},N,N`; qr → `^BQN,2,mag,ec` + `^FDLA,`; datamatrix → `^BXN,size,200`.
               copies → `^PQ n`. dbg → 모든 요소에 외곽 `^GB` 1px 박스 추가(좌표 튜닝용).
  merge.ts     mergeJobs(labels[]) → 문자열 연결.
  index.ts     public API.
  *.test.mjs   emitter 스냅샷(요소별 1개씩), escape, measure.fitSize, media 테이블 정합(mm×8), dbg 박스.
```

## 3. /scale 임시 테스트 페이지 (POS)

- 라우트 `/scale` (`App.tsx` 라우트 추가), 홈 화면에 **"Scale / Label Test"** 버튼(임시 — 템플릿 확정 후 재배치).
- 화면 구성(조립만, 로직은 훅/라이브러리): ① 프린터 선택 — 기존 설정의 `zplNet`/`zplSerial` 중 `language==='zpl'` 인 것(`useZplPrinters` 재사용) ② 미디어 선택(5종) ③ **진단 라벨 인쇄** — 선택 미디어에 요소 종류 전부(한글 M/B/BK 텍스트·shrink 텍스트·line·box·ean13·code128·qr·datamatrix) + dbg 박스 ON/OFF 토글 ④ "ZPL 보기" 텍스트 영역(생성 문자열 확인) ⑤ 이후 템플릿 6종 버튼이 여기 붙는다(이번 범위 아님).
- 전송: 기존 `printLabel(printer, {language:'zpl', data})` IPC 재사용. **새 경로에서만** 폰트 전송 중 게이트: `zpl-font:status` 의 busy 를 확인해 busy 면 안내 후 거부(`isZplFontTransferRunning` 노출용 IPC 가 없으면 status 호출로 대체).

## 4. 테스트·검증

- `node --test` 코어 테스트 그린, `tsc -p tsconfig.web.json` 기존 3건 외 신규 0.
- 실물: XD3-40d(192.168.0.125:9100, NOTOKRM 주입됨) 로 6040 진단 라벨 — 한글·바코드·dbg 박스 확인(오너).

## 5. 비고(기록)

- 폰트 B/BK 는 XD3 에 아직 미주입(M 만) — 진단 라벨은 미주입 폰트 줄이 비어 보일 수 있음. 주입은 POS 폰트 패널(Bixolon 은 `^HW` 응답이 없어 blind — 패널 개선은 별건).
- 레거시 어휘(`MediaSize` 3종, operations 3슬롯, runner 3종) 통일은 이식 단계.

## 6. 템플릿 단계 (2026-08-26 오후 — 에센셜 확정 후)

**확정된 에센셜**: ZPL 단일 · 폰트 = Noto Sans KR **서브셋** 3웨이트(M/B/BK, 각 ≈2.5MB,
한글 11,172자 + ASCII 전부 + 기호·자모; 원본 6.2MB 는 Bixolon 사용자 플래시
한도 초과로 2번째 파일부터 잘림) · 취소선은 `^GB` 선(`strike` 헬퍼, 폭은 `measure`
근사) · 헤드라인 Black 52~62 가시성 오너 확인("아쉽지만 됨") · 60×40 목업 1D/2D
오너 확인.

### 6.1 폰트 정본 교체
`retail_pos_app/resources/fonts/NotoSansKR-{Medium,Bold,Black}.ttf` 를 서브셋
파일로 교체(같은 파일명·객체명 유지 → `main/zpl-font/catalog.ts` 무변경, 단
바이트 수는 실측으로 갱신되므로 주석만). 서브셋 생성 스크립트
`retail_pos_app/scripts/subset-noto-kr.py`(fonttools, 유니코드 범위 명시)를
리포에 커밋해 재현 가능하게.

### 6.2 템플릿 = `label-core/templates/*.ts` — `(input) → Label` 순수 함수
공통 입력은 label-core 자체 타입(앱 모델 import 금지; 어댑터는 화면/훅 몫).
| 파일 | 미디어 | 입력 | 레이아웃 정본 |
|---|---|---|---|
| `scale-6040.ts` | 6040 | `ScaleLabelInput`(nameKo/En, packedOn/usedBy 표시문자열, weightText, unit, unitPriceText, wasUnitPriceText?, totalText, wasTotalText?, barcode12 \| pp payload, storeName?, storeAddress?) | 오늘 목업 1D/2D (BACKLOG §AC-12 목업 ZPL 참조): 이름 Bold30 · 정보 4열 · EAN13 60h / QR mag3 · $/kg Bold40 · TOTAL Black48 · 푸터 Black34+M20 중앙 |
| `ingredient-58100.ts` | 58100 | 위 + `ingredients` | 구 scale `ingredientLabelTemplate` 배치를 464×800 에 옮김(이름 3줄 Bold50, 재료 M20 wrap, 정보 y≈565, 날짜 y≈665, 바코드 y≈638), 푸터 없음 |
| `price-tag-7030.ts` | 7030 | `PriceTagInput`(nameKo/En, uom, priceCents, wasPriceCents?, promoRange?, barcode) | POS `buildPriceTag7030` 배치(분할 가격 61/41 · was 줄 · ko/en 이름 · 바코드 텍스트 · DataMatrix 350,10) — 550 이 아니라 560 폭 사용 |
| `price-tag-7090.ts` | 7090 | 위 + `memberPriceCents?`, `promoName?`, `storeName?`, `mode:'current'\|'normal'` | POS `label-7090-v2` 4케이스(normal/promo × guest/member) 좌표 그대로, 헤드라인 Black 52/62(shrink min 36/42), 가격 Black, 점선 구분선은 `^GB` 점 반복 대신 `^GB` 실선 1px(단순화) |
| `order-100100.ts` | 100100 | `OrderLabelInput`(orderNo, dueText, nameKo/En, qty, optionLines[], orderQrData, ppQrData?) | POS `order-label-zpl` 배치를 800×800 에 옮김, **QR 두 칸을 실제 ^BQ 로**(order QR 필수, PP QR 은 입력 있을 때만) |

모든 템플릿: `strike()` 로 취소선, `shrink` 로 이름/헤드라인 자동축소, `dbg` 통과.
좌표는 첫 버전이고 `/scale` 페이지에서 실물 튜닝(이 문서의 표는 시작값).

### 6.3 PP 바코드 정본 확장
`libs/pp-barcode.ts`(sale-core 정본)에 `"00": 2`, `"07"` packedOn ISO, `"08"`
usedBy offset **추가**(선택 필드, 파서는 기존대로 무시 가능, 클램프 유지).
러너는 다음 sync 때 반영. label-core 는 이 파일을 import 하지 않고 `ppQrData`
문자열을 입력으로 받는다(의존 0 유지) — 문자열 생성은 화면 어댑터에서.

### 6.4 `/scale` 페이지 확장
템플릿 5종 버튼(각각 하드코드 샘플 데이터 — 오늘 목업 값 재사용, 7090 은 4케이스
버튼) + 기존 진단 라벨 + dbg 토글 + ZPL 미리보기. 프린터의 `mediaSize` 와
템플릿 미디어가 다르면 경고만(강제 차단 안 함 — 지금 60×40 용지에 7090 을
찍어보는 식의 테스트 허용).

### 6.5 테스트
템플릿마다 스냅샷 테스트(샘플 입력 → ZPL 문자열, 요소 경계가 미디어 안), 7090
4케이스 분기, 100100 옵션 줄 넘침 `+N more`, PP 00/07/08 빌드/파싱 라운드트립.
