# zpl-font

네트워크 ZPL 라벨 프린터의 **플래시 메모리(`E:`)** 에 한글 TrueType 폰트를 주입한다.
폰트가 들어가면 ZPL 텍스트 필드(`^A@` + `^CI28`)로 한글을 직접 찍을 수 있다.

## 왜 필요한가

현재 ZPL 텍스트 경로는 한글을 못 쓴다. `components/orders/order-label-zpl.ts`의
`sanitizeZplText()`가 `[^\x20-\x7e]`를 전부 제거해서 `name_ko`가 통째로 버려지고,
한글은 SLCS euc-kr이나 캔버스 raster `^GFA` 경로에서만 나온다. 프린터에 폰트가 없기
때문이다. 이 라이브러리가 그 전제를 바꾼다.

## 경계 — 중요

**이 디렉토리는 앱의 다른 어떤 모듈도 import 하지 않는다. `electron`조차 쓰지 않는다.**
폰트 디렉토리는 주입받는다(`createZplFontService({ fontDir })`).

라벨 생성 계층(SLCS/ZPL)은 재작성 예정이다. 그때 이 파트가 같이 뜯기지 않도록 의존을
한 방향으로만 뒀다:

```
InterfaceSettingsScreen ─▶ ZplFontPanel ─▶ window.electronAPI
                                                  │
                                          ipc/zpl-font.ts   ← electron은 여기까지만
                                                  │
                                            zpl-font/       ← 순수 node
```

`ipc/zpl-font.ts`가 유일한 어댑터다. 여기서 패키징된 폰트 경로를 풀고, IPC 채널을 열고,
진행률을 렌더러로 흘린다. 그 파일 하나만 갈아끼우면 이 라이브러리는 다른 앱에서도 돈다.

## 쓰는 법

```ts
const service = createZplFontService({ fontDir: "/path/to/fonts" });

await service.status({ host, port }, { dpi: 203 });    // 설치 여부 · 여유 용량 · 해상도 · capabilities
await service.install({ host, port }, { onProgress }); // ~DY 스트리밍 + 검증(또는 검증 라벨)
await service.testPrint({ host, port }, { widthMm: 100 });
service.isBusy({ host, port });                       // 설치 후 검증 라벨까지 true로 유지된다
```

## 동봉 폰트

`resources/fonts/` (build.files · asarUnpack에 이미 포함 — electron-builder 설정 변경 없음)

| 파일 | 프린터 오브젝트 | 크기 |
|---|---|---|
| `NotoSansKR-Medium.ttf` | `E:NOTOKRM.TTF` | 2.45 MB |
| `NotoSansKR-Bold.ttf` | `E:NOTOKRB.TTF` | 2.45 MB |
| `NotoSansKR-Black.ttf` | `E:NOTOKRBK.TTF` | 2.45 MB |

**2026-08-26에 서브셋으로 교체됐다**(파일명·오브젝트명 동일, 5.93 MB → 2.45 MB). 크기는
전부 디스크에서 읽으므로 코드 상수는 없다 — 폰트만 갈아끼우면 된다.

서브셋이지만 **한글 음절 11,172자는 그대로 전부 커버한다**(cmap 12,001 코드포인트 = 음절
11,172 + 호환 자모 94 + ASCII 95 + 구두점/기호). 빠진 건 한자 — 서브셋에 CJK 통합한자가
0자다. 라벨에 한자를 찍을 일이 생기면 이 폰트로는 안 된다.

합계 7.4 MB이고 ZD421의 사용자 플래시는 64 MB다. 설치본만 그만큼 커지고, electron-updater는
`.blockmap` 차등 다운로드라 업데이트 때는 다시 안 내려간다.

**TrueType(glyf)이어야 한다.** upstream이 같이 배포하는 OpenType/**CFF** face는
ZD421이 올바른 바이트 수로 저장해놓고 아무것도 인쇄하지 않았다. 프린터 내장 폰트가
전부 glyf인 것과 일관된다. `catalog.ts`가 sfnt 매직을 검사해서 CFF면 전송 전에 거부한다.

폰트 생성 절차는 `kortoaus/zpl_font_injector` 리포의 `tools/instance-fonts.sh` 참고.
Google Fonts는 Noto Sans KR을 가변폰트로만 배포하는데 ZPL 펌웨어가 `fvar`를 보간하지
못한다. 다만 그 가변폰트가 TrueType 플레이버라 wght 축을 500/700/900에 고정하면
네이티브 static glyf face가 나온다 — 변환이 아니라 인스턴싱이다.

## 프린터가 아무 대답도 안 할 때 (blind mode)

**Bixolon XD3/XD5는 BPL-Z(ZPL 에뮬레이션)에서 `~DY` 다운로드도 받고 `^A@`+`^CI28` 한글도
Zebra와 똑같이 찍지만, 호스트 쿼리에 절대 응답하지 않는다.** `~HI`·`^HW`·`^HH` 전부 바이트가
0개다(2026-08-26 실기 확인). 소켓은 열리고 명령도 먹는데 말만 안 한다.

그래서 `status()`가 `~HI`에 한 바이트도 못 받으면 **실패가 아니라 분류**로 처리한다:

```ts
status.capabilities  // { responds: false }          ← Bixolon
                     // { responds: true, model, dpi } ← Zebra
```

| | `responds: true` (Zebra) | `responds: false` (Bixolon) |
|---|---|---|
| `status()` | `^HW` 파싱 → installed/missing/mismatch | `^HW` **안 물어봄**(타임아웃 2번 낼 이유 없음) · 전부 `unknown` |
| dpi | `~HI`가 알려준 값 | 모름 — 호출자가 넘긴 값, 기본 203 |
| `install()` | 크기 비교로 skip → 전송 → `^HW` 재검증 | skip 없이 전부 전송 → **검증 라벨 자동 출력** → `unverified` |
| `testPrint()` | 설치 확인된 폰트만 | 동봉 폰트 아무거나 (설치 여부가 바로 이 라벨이 답할 질문이라서) |
| 실패 | 검증 불일치면 throw | **throw 안 함** — 라벨 보고 판단하라는 메시지를 돌려준다 |

전송 자체가 죽는 건(연결 끊김·프린터가 안 읽음) 여전히 throw다. 상태를 모르는 것과 전송이
실패한 것은 다른 얘기다.

검증 라벨에는 프린터 **내장 `^A0` 폰트로** 두 줄이 더 붙는다(`PROOF_BUILTIN_REFERENCE`,
`PROOF_VERDICT` = "If Korean shows above, install OK"). 다운로드가 전부 실패해도 이 두 줄은
나오기 때문에, **백지 라벨 = 용지/전원 문제, 한글만 빈 칸 = 폰트 문제**로 갈린다.

전송 속도는 Bixolon 약 **195 KB/s**(2.45 MB 하나에 약 13초, 3종 약 39초), Zebra 약
**600 KB/s**(하나에 약 4초, 3종 약 13초)다.

## 라벨에서 쓰기

```zpl
^XA
^CI28
^FO40,40^A@N,40,40,E:NOTOKRB.TTF^FH^FD동해물과 백두산이^FS
^XZ
```

`^CI28`은 UTF-8 선택, `^A@N,높이,너비,E:파일명`은 다운로드 폰트 호출(단위 dot).

`^FH`가 필요한 이유: ZPL은 `^`와 `~`를 **명령 프리픽스**로 읽는다. `^FD` 데이터에 그대로
넣으면 라벨이 깨진다. `escapeFieldData()`가 `^`→`_5E`, `~`→`_7E`, `_`→`_5F`로 치환하고
한글 UTF-8 바이트는 그대로 통과시킨다.

## ⚠️ 주입 중 인쇄 충돌

`~DY` 헤더를 받은 프린터는 **선언한 바이트 수를 채울 때까지 포트로 들어오는 모든 것을
폰트로 삼킨다.** 주입이 도는 11초 동안 같은 프린터로 라벨을 뽑으면 그 ZPL이 폰트
바이트로 흡수되어 **폰트가 깨지고 라벨도 사라진다.**

지금은 UI 경고와 주입 후 `^HW` 재검증으로 커버한다. `service.isBusy()`는 그래서 노출해
뒀다 — 라벨 파이프라인을 재작성할 때 `ipc/label.ts`에서 `isZplFontTransferRunning()`을
보고 큐잉하면 된다. **지금은 아무도 안 쓴다.**

## 테스트

```sh
npm run test:zpl-font
```

프린터 없이 전부 돈다. `mock-printer.mjs`가 실물의 까다로운 습성 세 개를 흉내낸다 —
`t` 바이트를 해석 없이 삼키는 것, 응답 후에도 EOF를 안 보내고 연결을 유지하는 것, 그리고
`{ silent: true }`면 **다 받아먹고 한 바이트도 답하지 않는 것**(Bixolon). 연결이 중간에
끊기는 경우, 프린터가 읽기를 멈추는 경우(`pauseOnConnect`), 저장된 크기가 다른 경우,
펌웨어가 여유 용량을 보고하지 않는 경우까지 덮는다.

`ts-resolve.mjs`는 테스트 전용 리졸버다. node의 ESM 로더는 확장자를 요구하는데 이 리포
관례는 확장자 없는 relative import라, 공유 tsconfig를 건드리지 않고 메우기 위해 있다.

## 실기 확인 기록

**Zebra ZD421-200dpi / V93.21.37Z / 203 dpi:**

- OpenType/CFF face → 올바른 크기로 저장되지만 **아무것도 인쇄 안 됨**
- TrueType(glyf) static face → **한글 정상 출력**
- 전송 속도 약 600 KB/s → 2.45 MB 하나에 약 4초, 3종에 약 13초 (서브셋 이전 5.93 MB일 때
  하나에 약 11초, 3종 약 35초였다)
- `^HW` 응답에 파일 목록은 정상, **여유 용량 라인은 없음** → `freeBytes`가 nullable인 이유

**Bixolon XD3 / XD5, BPL-Z 모드 (2026-08-26, BACKLOG §AC-11):**

- `~DY` 다운로드 정상 수신, `^A@` + `^CI28` 한글 **정상 출력** — Zebra와 동일
- `~HI` · `^HW` · `^HH` → **응답 바이트 0개.** 타임아웃이 아니라 아예 말을 안 한다
- 전송 속도 약 195 KB/s → 2.45 MB 하나에 약 13초, 3종에 약 39초
- 이 한 가지 습성 때문에 위의 blind mode가 있다
