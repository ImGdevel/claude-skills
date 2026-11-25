# claude-skills

이 저장소는 개인 Claude Code 스킬을 모아 둔 플러그인 마켓플레이스(`my-skills`)입니다. 스킬을 주제별 플러그인으로 묶어 두었기 때문에 묶음 단위로 켜고 끌 수 있습니다.

## 구조

```
.claude-plugin/marketplace.json   마켓플레이스 목록
plugins/<plugin>/
  .claude-plugin/plugin.json      플러그인 정보
  skills/<skill>/SKILL.md         스킬 본문
```

| 플러그인 | 스킬 |
|---|---|
| dev-workflow | verified-build |
| system-tools | disk-report |
| ui-design | unslop (CC BY 4.0, Damir Sokolovsky), extract-design, generate-ui-from-brand (dembrandt, MIT), 출처는 `SOURCE.md` |
| skill-ops | organize-skills (스킬 정리·추가 절차) |
| thinking-tools | grill-me, grilling, teach, handoff, wait-what, to-questionnaire (Matt Pocock, MIT, 출처는 `SOURCE.md`) |

thinking-tools의 grilling을 뺀 5개는 `/thinking-tools:grill-me`처럼 슬래시 명령으로만 실행됩니다.

외부 스킬 팩은 원칙적으로 이 저장소에 복사하지 않고, 원본 마켓플레이스에서 설치해 업데이트를 받습니다. 원본 팩에서 일부만 필요할 때만 예외로 골라 복사하고, 그 출처를 `SOURCE.md`에 남깁니다.

- `agent-skills@addy-agent-skills`: [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills)
- `humanizer@humanizer`: [blader/humanizer](https://github.com/blader/humanizer) (AI 티 나는 글 다듬기)

## 연결 방식

`~/.claude/settings.json`에서 이 폴더를 `directory` 마켓플레이스로 등록합니다. 플러그인은 복사되지 않고 이 폴더에서 바로 로드되므로, 파일을 고친 뒤 `/reload-plugins`를 실행하거나 새 세션을 열면 반영됩니다. 버전을 올릴 필요는 없습니다.

```json
"extraKnownMarketplaces": {
  "my-skills": { "source": { "source": "directory", "path": "C:/Users/imdls/workspace/claude-skills" } },
  "addy-agent-skills": { "source": { "source": "github", "repo": "addyosmani/agent-skills" }, "autoUpdate": true },
  "humanizer": { "source": { "source": "github", "repo": "blader/humanizer" }, "autoUpdate": true }
},
"enabledPlugins": {
  "dev-workflow@my-skills": true,
  "system-tools@my-skills": true,
  "ui-design@my-skills": true,
  "skill-ops@my-skills": true,
  "thinking-tools@my-skills": true,
  "agent-skills@addy-agent-skills": true,
  "humanizer@humanizer": true
}
```

## 자주 하는 작업

- **새 스킬 추가**: `plugins/<알맞은 플러그인>/skills/<이름>/SKILL.md`를 만들고 `/reload-plugins`를 실행합니다.
- **새 묶음 추가**: `plugins/<새 플러그인>/`을 만들고, `marketplace.json`과 `enabledPlugins`에 항목을 추가합니다.
- **묶음 끄기**: `enabledPlugins`에서 해당 값을 `false`로 바꾸거나 `/plugin` 메뉴에서 끕니다.
- **스킬 안에서 파일 경로 쓰기**: `${CLAUDE_SKILL_DIR}`(스킬 폴더) 또는 `${CLAUDE_PLUGIN_ROOT}`(플러그인 폴더)를 씁니다. 절대 경로는 쓰지 않습니다.

## 여기서 관리하지 않는 것

- `~/.claude/skills/`의 `computer-use`, `orca-linear`, `orchestration`: Orca 앱이 `~/.agents/skills`로 연결해 관리합니다.
- `~/.claude/skills/synced/`: claude.ai 계정 스킬로, 앱이 동기화합니다.
