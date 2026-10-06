# 릴리스 리포 분리 → 소스 리포 비공개 전환 런북

작성 2026-09-30. 목표: `kortoaus/ktp-v5-retail-pos`(소스)를 비공개로 바꾼다.

## 왜 순서가 필요한가

계산대 앱은 부팅할 때 GitHub Releases에서 새 버전을 찾는다(`retail_pos_app/src/main/updater.ts`).
앱 안에는 GitHub 로그인 정보가 없어서, 피드가 있는 리포가 비공개가 되면 업데이트 확인이 실패한다.
실패는 로그에만 남고 화면에는 안 보인다.

피드 주소는 설치본 안에 박혀 있다. 1.8.3 이하 설치본은 **소스 리포**의 Releases를 본다.
그래서 "새 주소를 아는 버전"을 옛 주소에 한 번 올려 주는 다리 릴리스가 필요하다.

## 준비된 것 (브랜치 `chore/release-feed-repo`)

- 공개 리포 `kortoaus/ktp-v5-retail-pos-releases` 생성 (README만 있음, 소스 없음)
- `retail_pos_app/package.json` `build.publish.repo` → 새 리포
- `.github/workflows/build-windows.yml` → `RELEASES_REPO_TOKEN` 시크릿으로 배포, 산출물 보관 3일

이 브랜치는 **아직 main에 합치지 않았다.** 합친 뒤 릴리스하면 새 리포에만 올라가서,
다리 단계(아래 3번)를 빼먹으면 1.8.3 계산대는 새 버전을 못 본다.

## 순서

계산대는 업데이트를 받으면 묻지 않고 재시작한다. 영업 중이 아닐 때 한다.

1. **토큰 발급 (오너).** GitHub → Settings → Developer settings → Fine-grained tokens.
   Repository access는 `ktp-v5-retail-pos-releases` 하나만, 권한은 `Contents: Read and write`.
   만료일은 길게. 발급 후 터미널에서:
   ```bash
   gh secret set RELEASES_REPO_TOKEN -R kortoaus/ktp-v5-retail-pos
   ```
2. **브랜치를 main에 합치고 릴리스.**
   ```bash
   git switch main && git merge --no-ff chore/release-feed-repo && git push
   ./scripts/release-pos.sh patch        # v1.8.4
   ```
   CI가 끝나면 새 리포에 v1.8.4 Release(설치 파일, blockmap, `latest.yml`)가 생겼는지 확인.
3. **다리: 같은 파일을 소스 리포 Releases에도 올린다.**
   ```bash
   mkdir -p /tmp/pos-bridge && cd /tmp/pos-bridge
   gh release download v1.8.4 -R kortoaus/ktp-v5-retail-pos-releases
   gh release create v1.8.4 -R kortoaus/ktp-v5-retail-pos --title 1.8.4 --notes "Bridge release" ./*
   ```
   `latest.yml`은 파일 이름과 해시만 담고 있어서 어느 리포에 있어도 동작한다.
4. **모든 계산대를 재시작해 1.8.4로 올린다.** 확인 위치: Interface Settings 화면 맨 아래
   `App version`. 한 대라도 1.8.3에 남으면 그 단말은 이후 자동 업데이트가 끊긴다
   (새 설치 파일로 수동 설치해야 함).
5. **매장 서버의 git 접근 확인.** `retail_pos_server` 폴더에서 `git remote -v`.
   로그인 없이 받아 오게 돼 있으면 비공개 전환 후 `git pull`이 막힌다 — 전환 전에 인증을 넣는다.
6. **비공개 전환.**
   ```bash
   gh repo edit kortoaus/ktp-v5-retail-pos --visibility private --accept-visibility-change-consequences
   ```
7. 확인: 계산대 한 대를 재시작해 정상 부팅되는지, 다음 릴리스 때 새 리포에서 업데이트가 받아지는지.

## 되돌리기

6번 전까지는 아무것도 잃지 않는다. 6번 이후 문제가 생기면 같은 명령에 `--visibility public`.
