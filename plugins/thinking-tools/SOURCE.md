# 출처

이 폴더의 스킬은 [mattpocock/skills](https://github.com/mattpocock/skills)의 `skills/productivity/`에서 가져온 것입니다. MIT 라이선스이며 전문은 LICENSE에 있습니다.

- 가져온 커밋: `d65391149dbb5fe76478e76fa8d5122b2aa5a70e` (2026-11-25)
- 스킬: grill-me, grilling (grill-me가 호출), handoff, teach, to-questionnaire, wait-what
- 원본 플러그인(`mattpocock-skills@mattpocock`)을 그대로 설치하지 않은 이유: 스킬 27개가 한꺼번에 들어오고, 그중 tdd·code-review 등이 이미 쓰는 스킬과 겹치기 때문입니다.

원본이 바뀌었는지 확인하는 방법 (organize-skills 스크립트):

    bash ../skill-ops/skills/organize-skills/scripts/check-upstream.sh https://github.com/mattpocock/skills skills/*

이 명령은 로컬 파일이 원본 기록에 있는지만 봅니다. 새로 바뀐 내용을 가져오려면 원본 `skills/productivity/<name>`을 다시 복사하고 위 커밋 값을 갱신합니다.

## 로컬 수정

- `grill-me/SKILL.md`: 호출 대상 `"grilling"`을 `"thinking-tools:grilling"`으로 바꿨습니다. 플러그인에 들어가면 스킬 이름 앞에 플러그인 이름이 붙기 때문입니다. 그래서 check-upstream에서 이 파일은 NOT-IN-HISTORY로 나오는 것이 정상입니다.
