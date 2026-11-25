---
name: organize-skills
description: ~/.claude/skills에 흩어진 스킬을 정리해 개인 플러그인 마켓플레이스(Git 저장소)로 옮긴다. 외부 스킬 팩은 원본 마켓플레이스에서 설치하고, 직접 만든 스킬만 주제별 플러그인으로 묶는다. 사용자가 "스킬 관리가 어렵다", "스킬 정리해줘", "스킬을 git으로 관리하고 싶다", "스킬을 묶어서 켜고 끄고 싶다", "새 스킬을 내 마켓플레이스에 추가해줘", "다른 PC에서도 같은 스킬 쓰고 싶다"고 하거나, ~/.claude/skills에 출처 모를 폴더가 쌓였을 때 사용한다. 외부 스킬을 마켓플레이스에 추가하는 요청에도 사용한다.
---

# organize-skills

스킬을 `~/.claude/skills`에 폴더째 두면 세 가지 문제가 생긴다. 버전 관리가 안 되고, 묶음 단위로 켜고 끌 수 없고, 외부 팩은 업데이트를 받지 못해 낡는다. 이 스킬은 그 상태를 아래 구조로 바꾼다.

- 개인 스킬: 로컬 Git 저장소 하나 = 플러그인 마켓플레이스 하나. 주제별 플러그인으로 묶는다.
- 외부 스킬 팩: 복사하지 않는다. 원본 저장소의 마켓플레이스를 등록해 설치하고 업데이트를 받는다.

사용자에게는 한국어로 답한다. 이미 저장소가 있으면 (`~/workspace/claude-skills` 등, `.claude-plugin/marketplace.json` 확인) 새로 만들지 말고 거기에 추가한다.

## 1. 목록 만들기

```bash
bash "${CLAUDE_SKILL_DIR}/scripts/inventory.sh"
```

출력 항목은 이렇게 다룬다.

| 종류 | 의미 | 처리 |
|---|---|---|
| `link` | 심볼릭 링크·junction. 다른 앱(예: Orca → `~/.agents/skills`)이 관리 | 그대로 둔다. 옮기면 그 앱이 다시 만들거나 깨진다 |
| `synced` | claude.ai 계정 스킬. 앱이 동기화 | 그대로 둔다 |
| `dir` | 실제 폴더 | 출처를 확인해 아래 2번으로 분류 |

`settings.json`의 `extraKnownMarketplaces`/`enabledPlugins`, `plugins/installed_plugins.json`도 읽어 이미 설치된 것과 겹치지 않게 한다. claude.ai 계정에 설치한 플러그인은 데스크톱 앱이 `~/.claude/plugins/synced/<bucket>/`로 내려받는다. 이 플러그인은 installed_plugins.json에 없고 CLI에서 `<name>@synced`로 보이며, 이 저장소에서 관리하지 않는다.

## 2. 출처 찾기

폴더마다 원본이 있는지 확인한다. 단서는 frontmatter의 `author`/`license`/`metadata`, 본문 크레딧, 같은 날짜에 한꺼번에 생긴 폴더 묶음이다. 묶음이면 이름 몇 개로 GitHub를 찾는다.

```bash
gh search code "name: <skill-name>" --filename SKILL.md --limit 5
gh api repos/<owner>/<repo>/contents/.claude-plugin --jq '.[].name'   # marketplace.json 있는지
```

원본을 찾으면 로컬 사본을 직접 고쳤는지 확인한다. "원본과 다름"만으로는 판단할 수 없다. 대개 로컬이 옛 버전일 뿐이다. 그래서 로컬 파일이 원본 **git 기록 어딘가**에 있는지 본다.

```bash
bash "${CLAUDE_SKILL_DIR}/scripts/check-upstream.sh" <원본 git URL> <로컬 스킬 폴더>...
```

- 모든 파일이 `in-history` → 옛 버전일 뿐이다. 원본 플러그인으로 바꿔도 잃는 것이 없다.
- `NOT-IN-HISTORY` 파일이 있다 → 사용자가 고친 것일 수 있다. 내용을 보여 주고 어떻게 할지 묻는다. 고친 것을 살리려면 개인 플러그인으로 옮긴다. 이름이 겹치지 않게 해야 한다.

분류 결과:
- **원본에 마켓플레이스가 있음** → 3-B (원본에서 설치)
- **원본 플러그인이 원하는 것보다 훨씬 많이 담고 있음** (예: 5개를 원했는데 27개가 들어오고 기존 스킬과 겹침) → 원하는 것만 3-A로 가져온다. 이때 세 가지를 지킨다.
  - 해당 스킬이 다른 스킬을 부르면(`Call the Skill tool with "x"`) 그 스킬도 함께 가져온다. 호출 이름은 `<plugin>:x`로 고친다.
  - 플러그인 폴더에 원본 LICENSE와 `SOURCE.md`를 둔다. SOURCE.md에는 원본 URL, 커밋, 가져온 이유, 로컬 수정 내역을 적는다.
  - `disable-model-invocation: true`인 스킬은 모델의 스킬 목록에 안 보이고 `/<plugin>:<skill>`로만 실행된다. 확인할 때 목록에 없다고 실패로 보지 않는다.
- **원본은 있지만 마켓플레이스가 없음** → 3-A로 옮긴다. 라이선스와 크레딧은 유지하고, README에 원본 링크를 남긴다
- **원본 없음 (직접 만든 것)** → 3-A

## 3. 계획 확인

실행 전에 표 하나로 보여 주고 승인을 받는다. 표에는 스킬, 출처, 처리 방식(원본 설치 / 개인 플러그인 이름), 손대지 않는 항목을 넣는다. 플러그인은 함께 켜고 끌 만한 주제로 묶는다 (예: `dev-workflow`, `system-tools`, `ui-design`). 스킬마다 플러그인을 하나씩 만들면 오히려 관리가 어려워진다.

### 3-A. 개인 저장소에 넣기

구조는 다음과 같다.

```
<repo>/.claude-plugin/marketplace.json     plugins[].source = "./plugins/<name>"
<repo>/plugins/<name>/.claude-plugin/plugin.json   name, version, description, author, "skills": "./skills"
<repo>/plugins/<name>/skills/<skill>/SKILL.md
```

- 플러그인 이름은 기능을 드러내게 짓는다. `claude-`, `anthropic-`, `cc-plugin-`으로 시작하는 이름과 `claude`, `claude-code` 같은 이름은 예약어라 `plugin validate`에서 거부된다.
- 원본 폴더를 **복사**한다. 옮기는 것은 5번에서 한다.
- 스킬 본문의 절대 경로(`~/.claude/skills/<x>/...`)는 `${CLAUDE_SKILL_DIR}`로 바꾼다. 플러그인 폴더 전체를 가리킬 때는 `${CLAUDE_PLUGIN_ROOT}`를 쓴다. 이 두 변수는 SKILL.md 본문과 `allowed-tools`에서 치환된다.
- 스킬 **밖**에서 옛 경로를 쓰는 곳도 찾아 고친다. 바탕화면 바로가기, 작업 스케줄러, 다른 스크립트가 해당된다. 바로가기는 PowerShell `WScript.Shell`의 `CreateShortcut`으로 `Arguments`를 읽고 고친다.
- `__pycache__` 같은 생성물은 빼고 `.gitignore`를 둔다.
- 저장소가 처음이면 `git init -b main`을 하고 README에 구조, 연결 방식, 추가·끄기 절차를 적는다.

### 3-B. 원본 마켓플레이스 등록

marketplace.json의 `name`(마켓플레이스 이름)과 `plugins[].name`을 읽어 `<plugin>@<marketplace>` 형태로 설치한다.

## 4. 등록·설치

`~/.claude/settings.json`을 수정하기 전에 백업한다. 기존 키는 보존하고 병합한다.

```json
"extraKnownMarketplaces": {
  "<my-market>": { "source": { "source": "directory", "path": "C:/Users/<me>/workspace/claude-skills" } },
  "<upstream-market>": { "source": { "source": "github", "repo": "<owner>/<repo>" }, "autoUpdate": true }
},
"enabledPlugins": { "<plugin>@<my-market>": true, "<plugin>@<upstream-market>": true }
```

- `directory` 소스를 쓰면 플러그인을 복사하지 않고 그 폴더에서 바로 로드한다. 수정한 뒤 `/reload-plugins`만 하면 되고 버전을 올릴 필요도 없다. 개인 저장소에는 이 방식이 가장 편하다.
- 경로는 **슬래시(`/`)**로 쓴다. 셸에서 JSON을 만들 때 백슬래시가 사라져 `C:Usersme...`처럼 깨진 적이 있다.

CLI로 검증하고 설치까지 끝낸다. Windows 데스크톱 앱에서는 `claude`가 PATH에 없을 수 있다. 그럴 때는 `%LOCALAPPDATA%\Claude-Data\*\claude-code\<버전>\*\claude.exe`에서 찾는다.

`claude plugin marketplace add`는 settings.json의 `extraKnownMarketplaces`를 다시 쓰면서 기존 항목의 `autoUpdate`를 지운다. 마켓플레이스를 추가한 뒤에는 원본 마켓플레이스의 `autoUpdate: true`가 남아 있는지 확인하고, 없으면 다시 넣는다.

```bash
claude plugin validate <repo>
claude plugin marketplace add <repo 경로 또는 owner/repo>
claude plugin install <plugin>@<marketplace>
claude plugin list
```

## 5. 확인 후 원래 폴더 치우기

1. 새 세션에서 실제로 뜨는지 확인한다. 플러그인 스킬은 `<plugin>:<skill>` 이름으로 보인다.
   ```bash
   claude -p "From your available skills, print only names starting with '<plugin>:' ..., one per line." --model haiku --max-turns 1
   ```
2. 옮긴 `dir`은 `~/.claude/skills-backup-<날짜>/`로 **이동**한다. 삭제하지 않는다. `link`와 `synced`는 건드리지 않는다.
3. 커밋한다. 메시지 양식은 사용자 CLAUDE.md 규칙을 따른다.
4. 원격 push는 묻고 나서 한다. 스킬 본문에 개인 아티팩트 URL이나 경로가 들어 있을 수 있으니 **비공개** 저장소를 권한다 (`gh repo create <name> --private --source . --push`).
5. 백업 삭제도 묻고 나서 한다. 그 전에 백업의 모든 파일이 다른 곳(원본 git 기록이나 새 저장소)에 있는지 `check-upstream.sh`와 `diff -rq`로 보여 준다. 영구 삭제라는 점도 함께 알린다.

## 목록 페이지

설치된 플러그인과 스킬을 한 페이지로 보려면 아래 명령을 실행한다. 정리나 추가를 끝낸 뒤에도 실행해 결과를 보여 준다.

```bash
node "${CLAUDE_SKILL_DIR}/scripts/catalog.mjs" --app      # 새로 만들고 Edge/Chrome 앱 창으로 열기 (~/.claude/skill-catalog.html)
node "${CLAUDE_SKILL_DIR}/scripts/catalog.mjs" --install-shortcut   # 바탕화면 "스킬 목록" 바로가기 (Windows)
```

바로가기는 열 때마다 페이지를 새로 만들어서 항상 현재 상태를 보여 준다. 그래서 따로 훅을 둘 필요가 없다. 사용자가 다른 PC에서 쓰려고 하면 `--install-shortcut`을 다시 실행해 준다. 바로가기는 이 스크립트의 절대 경로를 가리키므로, 저장소 위치를 옮긴 뒤에도 다시 실행해야 한다.

페이지에서 확인할 수 있는 것:
- 플러그인별 켜짐 여부, 출처, 자동 업데이트, 훅·MCP·에이전트·명령
- 스킬마다 실행 방식(자동 선택 / 슬래시 전용), 목록과 본문의 토큰 크기
- 역할이 겹치는 스킬
- 플러그인 밖 스킬 (다른 앱 연결, claude.ai 동기화)

`--json <file>`을 붙이면 같은 데이터를 JSON으로도 남긴다. 페이지는 읽기 전용이다.

각 스킬은 한글 한 줄 요약을 먼저 보여 주고, 원문 설명은 눌러야 펼쳐진다. 요약은 `data/ko-summaries.json`에 있고, 스킬 원본은 번역하지 않는다.
- 요약마다 원문 설명의 해시(`src`)를 함께 저장한다. 원문이 바뀌면 "원문 바뀜"으로 표시하고 다시 만든다.
- `--app`으로 열 때 요약이 없거나 오래된 스킬이 있으면, 창을 띄운 뒤 백그라운드에서 `--fill-ko`를 실행한다. 이 명령은 claude CLI의 haiku로 요약을 만든다. 결과는 다음에 열 때 보인다.
- 스킬을 추가한 직후라면 직접 요약을 써서 `data/ko-summaries.json`에 넣어도 된다. 형식은 `{"ko": "...", "src": "<sha1(description) 앞 10자>"}`이고, 자동으로 만든 항목에는 `"auto": true`가 붙는다. 해라체 한 문장(80자 이내)으로 무엇을 하는지, 언제 쓰는지를 쓴다.

## 새 스킬 하나만 추가할 때

정리가 이미 끝난 상태라면 1~2번만 가볍게 한다.
- 외부 스킬: 원본에 마켓플레이스가 있으면 3-B를 따른다. 없으면 내용을 끝까지 읽고 3-A로 넣는다. 크레딧은 유지한다.
- 직접 만든 스킬: 알맞은 플러그인의 `skills/`에 넣고 `/reload-plugins`를 실행한다.
- 새 묶음이 필요할 때만 플러그인을 새로 만든다. 이때 `marketplace.json`과 `enabledPlugins`에도 항목을 추가한다.

## 마무리 보고

무엇을 어디로 옮겼는지, 무엇을 그대로 두었는지와 그 이유, 백업 위치, 확인 결과, 아직 하지 않은 것(push, 백업 삭제)을 짧게 보고한다.
