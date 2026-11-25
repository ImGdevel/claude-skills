# 출처

| 스킬 | 원본 | 라이선스 |
|---|---|---|
| unslop | Damir Sokolovsky, [heydamir.design/unslop](https://heydamir.design/unslop) | CC BY 4.0 (본문 크레딧 유지) |
| extract-design, generate-ui-from-brand | [dembrandt/dembrandt-skills](https://github.com/dembrandt/dembrandt-skills) `skills/`, 커밋 `97b20315b064b02da6a143c4a476b7ce91fc613c` (2026-11-25) | MIT (각 폴더의 LICENSE) |

## dembrandt 스킬

- 필요한 것: Node 18 이상. 스킬은 `npx dembrandt`로 CLI를 실행하고, 처음 쓸 때 `npx dembrandt install-browser`로 브라우저를 한 번 설치해야 합니다.
- 원본 플러그인(`dembrandt@dembrandt`)을 그대로 설치하지 않은 이유: 스킬 45개와 MCP 서버가 한꺼번에 들어오고, unslop·agent-skills와 겹칩니다.
- 오케스트레이터 `dembrandt` 스킬은 가져오지 않았습니다. 하위 스킬 약 40개를 불러 쓰는 구조라 단독으로는 쓸 수 없습니다.
- MCP 서버는 넣지 않았습니다. 두 스킬은 MCP가 없으면 CLI로 대신 동작합니다. MCP가 필요하면 `claude mcp add dembrandt -- npx -y dembrandt mcp`로 추가합니다.

원본이 바뀌었는지 확인하는 방법:

    bash ../skill-ops/skills/organize-skills/scripts/check-upstream.sh https://github.com/dembrandt/dembrandt-skills skills/extract-design skills/generate-ui-from-brand
