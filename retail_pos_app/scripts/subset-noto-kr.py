#!/usr/bin/env python3
"""Noto Sans KR 서브셋 생성 — 프린터 플래시 주입용 (2026-08-26, BACKLOG §AC-11/12).

원본 6.2MB 는 Bixolon XD3 사용자 플래시 한도를 넘겨 2번째 파일부터 잘린다.
한글 완성형 11,172자 + ASCII 전부 + 자모 + 통화/기호/원문자/전각 → ≈2.5MB.

사용:  pip install fonttools && python3 scripts/subset-noto-kr.py <원본 디렉토리> <출력 디렉토리>
"""
import os, sys
from fontTools import subset

UNICODES = ",".join([
    "U+0020-007E",   # ASCII 인쇄 가능 전부 (A-Z a-z 0-9 [ ] ( ) * % $ ~ - . / , : ; ' " 포함)
    "U+00A0-00FF",   # 라틴-1 보충 (° ± × ÷ 등)
    "U+2010-2027", "U+2030-205E",  # 대시·따옴표·‰·※ 등
    "U+20A0-20BF",   # 통화 (₩ € 등)
    "U+2100-214F", "U+2190-2199", "U+2200-22FF",  # ℃ ™ 화살표 수학기호
    "U+2460-24FF",   # 원문자 ①~⑳
    "U+25A0-25FF", "U+2600-26FF",  # ■ ◆ ★ 등
    "U+3000-303F",   # CJK 구두점
    "U+3131-318E",   # 한글 자모
    "U+AC00-D7A3",   # 한글 완성형 11,172자
    "U+FF01-FF60",   # 전각 영숫자·구두점
])

def main(src_dir, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    for weight in ("Medium", "Bold", "Black"):
        src = os.path.join(src_dir, f"NotoSansKR-{weight}.ttf")
        out = os.path.join(out_dir, f"NotoSansKR-{weight}.ttf")
        subset.main([src, f"--unicodes={UNICODES}", f"--output-file={out}",
                     "--no-hinting", "--layout-features=*", "--name-IDs=*"])
        print(weight, os.path.getsize(src) // 1024, "KB ->", os.path.getsize(out) // 1024, "KB")

if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
