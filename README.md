# Minecraft Seed Terrain Map

시드 **`7748490339196353958`**의 Java 1.20.1 오버월드를 `X/Z -10000 ~ +10000` 범위로 보여주는 정적 웹 지도입니다.

- 마우스 휠·버튼 확대/축소
- 마우스/터치 드래그 이동, 모바일 핀치 줌
- 우클릭·더블클릭·모바일 길게 누르기로 핑 추가
- 핑 이름·색상·X/Z 수정, 목록 이동, 삭제
- 핑 JSON 내보내기/가져오기
- `localStorage` 저장, 사용 불가 시 쿠키로 대체
- 구조물·광물·상자·몹·슬라임 청크 등은 표시하지 않음
- 표시 범위를 `-10000 ~ +10000` 밖으로 이동할 수 없게 제한

## GitHub Pages 배포

1. 새 GitHub 저장소를 만들고 이 폴더의 **숨김 폴더 `.github`까지 전부** 업로드합니다.
2. 저장소의 `Settings → Pages → Build and deployment → Source`를 **GitHub Actions**로 설정합니다.
3. `main` 또는 `master` 브랜치에 푸시합니다.
4. `Actions` 탭의 **Build terrain and deploy Pages** 작업이 끝나면 Pages 주소로 접속합니다.

워크플로는 고정된 Cubiomes 커밋을 내려받아 Java 1.20 지형을 생성하고, 512px 타일 피라미드로 변환한 뒤 GitHub Pages에 배포합니다. 저장소에는 빠른 UI 확인용 근사 미리보기도 들어 있지만, Pages 배포본에서는 생성된 Cubiomes 타일이 자동으로 우선 사용됩니다.

## 로컬에서 정확 타일 생성

Linux, macOS 또는 WSL에서 다음을 실행합니다.

```bash
python3 -m pip install -r requirements.txt
bash tools/build_exact.sh
python3 -m http.server 8080 -d dist
```

브라우저에서 `http://localhost:8080`을 엽니다. `git`, `make`, C 컴파일러, Python 3이 필요합니다.

UI만 빠르게 확인하려면 빌드 없이 다음을 실행해도 됩니다.

```bash
python3 -m http.server 8080 -d web
```

이 경우 화면 상단에 **로컬 미리보기**가 표시됩니다.

## 지도 데이터 방식

- 버전: Java 1.20.1 (`MC_1_20`)
- 범위: X/Z `-10000` 이상 `+10000` 이하
- 원본 해상도: 4블록당 1픽셀, 5000 × 5000 샘플
- 생물군계 색: 블록 Y=320에서 샘플링한 Cubiomes 기본 팔레트(동굴 전용 생물군계 배제)
- 음영: Cubiomes의 근사 표면 고도에 기반한 지형 음영
- 게임 월드 파일이나 블록·구조물 내용은 읽거나 노출하지 않음

## 핑 저장 위치

기본 키는 다음과 같습니다.

```text
seed-terrain:pings:7748490339196353958:java-1.20.1
```

브라우저 프로필이나 사이트 데이터를 삭제하면 핑도 삭제됩니다. 중요한 핑은 사이드바의 **내보내기**로 JSON 백업할 수 있습니다.

## 주요 파일

```text
web/                         정적 웹사이트
web/app.js                   캔버스 지도·줌·드래그·핑 로직
web/assets/terrain-preview.webp
                             정확 타일 생성 전 로컬 미리보기
tools/render_map.c           Cubiomes 지형/고도 원시 데이터 생성
tools/build_tiles.py         음영 처리 및 타일 피라미드 생성
.github/workflows/deploy-pages.yml
                             GitHub Pages 자동 빌드·배포
```

## 라이선스

이 프로젝트 코드는 MIT License입니다. 빌드 과정에서 사용하는 Cubiomes도 MIT License이며, 저작권은 Cubitect에 있습니다. Minecraft는 Mojang Studios/Microsoft의 상표이며 이 프로젝트는 공식 제품이 아닙니다.
