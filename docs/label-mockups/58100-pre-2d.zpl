; 58x100 성분표시 라벨 — 인쇄지(pre-printed) 대응 목업. 464x800 dots, 203 dpi.
;
; 용지에 이미 인쇄되어 있는 것 (템플릿이 절대 다시 그리지 않는다):
;   노란 헤더 y0–115 (매장명) · $/KG 캡션줄 y≈480 · 검정 캡션박스 y≈517–540
;   (NET WEIGHT x37–131 / UNIT PRICE x150–253 / TOTAL PRICE x272–404)
;   가로줄 y≈606 · PACKED ON x33–108 · USE BY x155–202 (y≈611–639)
;   노란 푸터 y≈735–800 (주소)
;
; 따라서 값만 찍는다: 매장 푸터 없음, 한글 없음, 단위 접미사 없음, $ 없음.
; was 줄은 레거시 저울 규칙 그대로 — $ 없이 Black 26, 박스 왼쪽 모서리 정렬,
; 캡션줄 바로 위(y450), 취소선은 실제 글자폭만큼(y463).
; 샘플 페이로드는 6040 목업과 같은 PP 문자열(30% 마크다운, 총액 19.71 / was 28.16).
^XA^CI28^PW464^LL800^LH0,0
^FO20,128^A@N,34,31,E:NOTOKRB.TTF^FB424,2,0,L,0^FH^FD[30% OFF] DS Salmon Sashimi (A)^FS
^FO20,212^A@N,18,16,E:NOTOKRM.TTF^FB424,5,0,L,0^FH^FDSalmon (Atlantic, farmed), Salt. Allergen information: Contains fish. Keep refrigerated below 4C. Consume on day of purchase.^FS
^FT310,440^BQN,2,2^FH^FDLA,00:{"00":2,"01":"0213436","02":[6200,5900,5700,5500,5300],"03":[5500,5300,5100,4900,4700],"04":512,"05":1,"06":300,"07":"2026-08-26","08":1}^FS
^FO150,450^A@N,26,23,E:NOTOKRBK.TTF^FH^FDwas 62.00^FS
^FO148,463^GB126,2,2^FS
^FO300,450^A@N,26,23,E:NOTOKRBK.TTF^FH^FDwas 28.16^FS
^FO298,463^GB126,2,2^FS
^FO37,562^A@N,34,31,E:NOTOKRB.TTF^FB94,1,0,C,0^FH^FD0.512^FS
^FO150,562^A@N,34,31,E:NOTOKRB.TTF^FB103,1,0,C,0^FH^FD55.00^FS
^FO272,556^A@N,44,40,E:NOTOKRBK.TTF^FB132,1,0,C,0^FH^FD19.71^FS
^FO33,660^A@N,24,22,E:NOTOKRB.TTF^FB100,1,0,L,0^FH^FD26/08^FS
^FO155,660^A@N,24,22,E:NOTOKRB.TTF^FB100,1,0,L,0^FH^FD27/08^FS
^XZ
; ---- 1D 변형: QR 자리에 EAN-13 (왼쪽, 같은 세로 밴드). 나머지 전부 동일. ----
; ^FO24,380^BY2,3,80^BEN,80,Y,N^FD200000102816^FS
