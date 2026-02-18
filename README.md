# Yejingram
웹 채팅 형식 LLM 대화 플랫폼, 예진그램입니다.

[한국어](./README.md) / [English](./README_en.md) / [日本語](./README_ja.md)

---

## Acknowledgment 고지사항=
이 프로젝트는 [dkfk5326/ArisuTalk](https://github.com/dkfk5326/ArisuTalk)의 아이디어에 영감받아 구축하였습니다. 각종 기능은 원본을 기반으로 추가 및 수정되었습니다.

## 설치 및 실행 방법

### 1. 기본 설치

```bash
git clone https://github.com/YEJIN-DEV/yejingram.git
cd yejingram
npm install
npm run build
```

## 동기화, 선톡 및 헤드리스 기능
예진그램은 원격 서버를 통한 데이터 동기화, 캐릭터의 선톡 기능, 그리고 GUI 없이 실행되는 헤드리스 모드를 지원합니다.

### 서버 경로
| 종류 | 경로 |
| --- | --- |
| **선톡** | server/proactive |
| **동기화** | server/sync |
| **헤드리스** | headless |

### 빌드 및 실행
각 경로(proactive, sync, headless)로 이동 후, 환경에 맞는 명령어를 사용하세요. 빌드시 경로에 dist/index.js가 생성됩니다.

| 옵션 | 명령어 | 특징 |
| --- | --- | --- |
| **개발모드** | `npx tsx index.ts` | 빌드 없이 즉시 실행
| **Standalone** | `npx esbuild index.ts --bundle --format=esm --platform=node --outfile=dist/index.js` | 모든 라이브러리를 포함한 단일 파일 생성 |
| **External** | `npx esbuild index.ts --bundle --format=esm --packages=external --platform=node --outfile=dist/index.js` | 로직만 번들링 (`node_modules` 필요) |


## Contribution

버그 리포트, 기능 제안, Pull Request 등 모든 형태의 기여를 적극 환영합니다!
포크 후 브랜치 생성하여 작업하시고, 변경 사항을 커밋한 뒤 Pull Request를 생성해 주세요.

> **주의:** PR 시 반드시 `dev` 브랜치로 보내주시기 바랍니다.

## License

이 프로젝트는 GPL-3.0 라이선스에 따라 라이선스가 부여됩니다. 자세한 내용은 [LICENSE](./LICENSE) 파일을 참조하세요.

---

피드백이나 개선 제안이 있으시면 언제든지 Issue나 Pull Request를 제출해 주세요.

감사합니다!
