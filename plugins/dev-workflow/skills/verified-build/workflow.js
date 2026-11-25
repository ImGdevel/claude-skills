export const meta = {
  name: 'verified-build',
  description: 'Spec, independent tests, diverse parallel attempts, adversarial check and repair loop, then apply the winner',
  whenToUse: 'A coding task (feature, bug fix, refactor) in a git repo with a runnable test command, where correctness matters more than token cost.',
  phases: [
    { title: 'Spec', detail: 'turn the request into acceptance criteria and distinct approaches' },
    { title: 'Tests', detail: 'a separate agent writes failing tests from the spec alone' },
    { title: 'Attempt', detail: 'one isolated implementation per approach' },
    { title: 'Check', detail: 'independent re-run of the tests plus an attempt to break it' },
    { title: 'Repair', detail: 'fix from the verbatim failure output, then re-check' },
    { title: 'Select', detail: 'pick among the candidates that survived' },
    { title: 'Apply', detail: 'apply the winner to the working tree and run the tests there' },
  ],
}

// ---------------------------------------------------------------- inputs
const input = typeof args === 'string' ? { task: args } : (args || {})
const TASK = input.task
if (!TASK) throw new Error('args.task is required: the coding task in plain words')
const ATTEMPTS = Math.max(1, Math.min(input.attempts || 3, 6))
const MAX_REPAIR = input.maxRepairRounds === undefined ? 2 : input.maxRepairRounds
const APPLY = input.apply !== false
const TAG = 'vb-tmp'

// Agents hand work to each other as git commits, never as pasted diffs:
// a model retyping a patch corrupts it, a SHA cannot be mistyped silently.
const GIT_RULES = `
Git handoff rules (follow exactly):
- You are in an isolated git worktree. Never push. Never touch branches other than your detached HEAD.
- Commits here are temporary handoff objects, not project history; use the message "wip: verified-build handoff".
- After committing, tag the commit so it cannot be garbage collected: git tag -f <tag> HEAD (the tag name is given below).
- Report the full 40-character SHA from: git rev-parse HEAD`

// ---------------------------------------------------------------- schemas
const SPEC = {
  type: 'object',
  required: ['goal', 'acceptanceCriteria', 'testCommand', 'approaches'],
  properties: {
    goal: { type: 'string' },
    acceptanceCriteria: { type: 'array', items: { type: 'string' } },
    outOfScope: { type: 'array', items: { type: 'string' } },
    relevantFiles: { type: 'array', items: { type: 'string' } },
    testCommand: { type: 'string' },
    approaches: { type: 'array', items: { type: 'string' } },
    openQuestions: { type: 'array', items: { type: 'string' } },
  },
}
const TESTS = {
  type: 'object',
  required: ['baseSha', 'testsSha', 'testFiles', 'failsBeforeImplementation'],
  properties: {
    baseSha: { type: 'string' },
    testsSha: { type: 'string' },
    testFiles: { type: 'array', items: { type: 'string' } },
    failsBeforeImplementation: { type: 'boolean' },
    redOutput: { type: 'string' },
  },
}
const CANDIDATE = {
  type: 'object',
  required: ['sha', 'summary'],
  properties: {
    sha: { type: 'string' },
    summary: { type: 'string' },
    selfReportedPass: { type: 'boolean' },
  },
}
const CHECK = {
  type: 'object',
  required: ['testsPass', 'testFilesUntouched', 'testOutput', 'defects'],
  properties: {
    testsPass: { type: 'boolean' },
    testFilesUntouched: { type: 'boolean' },
    testOutput: { type: 'string' },
    defects: {
      type: 'array',
      items: {
        type: 'object',
        required: ['criterion', 'reproduction', 'observed'],
        properties: {
          criterion: { type: 'string' },
          reproduction: { type: 'string' },
          observed: { type: 'string' },
        },
      },
    },
  },
}
const PICK = {
  type: 'object',
  required: ['winner', 'reason'],
  properties: { winner: { type: 'string' }, reason: { type: 'string' } },
}
const APPLIED = {
  type: 'object',
  required: ['applied', 'testsPass', 'testOutput'],
  properties: {
    applied: { type: 'boolean' },
    testsPass: { type: 'boolean' },
    testOutput: { type: 'string' },
    filesChanged: { type: 'array', items: { type: 'string' } },
    problem: { type: 'string' },
  },
}

// ---------------------------------------------------------------- 1. spec
phase('Spec')
const spec = await agent(
  `Turn this coding task into a precise specification. Read the code first; do not edit anything.

Task:
${TASK}

${input.testCommand ? `The test command is: ${input.testCommand}` : 'Find the command that runs this project\'s tests (package scripts, Makefile, CI config, README) and report it as testCommand.'}

Produce:
- goal: one sentence.
- acceptanceCriteria: each one observable and testable. Cover the stated behaviour, the edge cases it implies, and "existing tests keep passing".
- outOfScope: things a keen implementer might add that the task did not ask for.
- relevantFiles: where the change will land.
- approaches: exactly ${ATTEMPTS} genuinely different implementation strategies for THIS task (different structure or mechanism, not the same idea reworded). They will be built in parallel by separate engineers.
- openQuestions: ambiguities you resolved by assumption, with the assumption you made.`,
  { label: 'spec', phase: 'Spec', schema: SPEC, agentType: 'Plan' },
)
if (!spec) throw new Error('Spec agent returned nothing')
const approaches = spec.approaches.slice(0, ATTEMPTS)
if (approaches.length < ATTEMPTS) log(`Spec gave ${approaches.length} approaches, fewer than the ${ATTEMPTS} requested; running ${approaches.length} attempts`)

const specText = `Goal: ${spec.goal}

Acceptance criteria:
${spec.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

Out of scope:
${(spec.outOfScope || []).map(c => `- ${c}`).join('\n') || '- (none listed)'}

Relevant files: ${(spec.relevantFiles || []).join(', ') || '(not listed)'}
Test command: ${spec.testCommand}`

// ---------------------------------------------------------------- 2. tests
// Written by an agent that never sees the approaches, so the tests encode the
// spec and not one implementer's reading of it.
phase('Tests')
const tests = await agent(
  `Write the tests for a change that has NOT been implemented yet. Do not implement it.

${specText}

Steps:
1. Record the starting commit: git rev-parse HEAD (report as baseSha).
2. Write tests in the project's existing test framework and style, at least one per acceptance criterion, including the edge cases.
3. Run the test command. The new tests must fail because the behaviour is missing, not because of a syntax or import error in the test itself. Fix the tests until that is true. Report the failing output as redOutput and set failsBeforeImplementation.
   If the task is a pure refactor where behaviour must not change, tests that pass now are correct; set failsBeforeImplementation to false and say so in redOutput.
4. Commit only the test files.
${GIT_RULES}
Tag name: ${TAG}-tests
Report the commit as testsSha and list testFiles (repo-relative paths).`,
  { label: 'tests', phase: 'Tests', schema: TESTS, isolation: 'worktree' },
)
if (!tests) throw new Error('Test agent returned nothing')
if (!tests.failsBeforeImplementation) log('Note: tests pass before any implementation (expected only for a pure refactor)')

// ---------------------------------------------------------------- 3-5. attempt, check, repair
const checkPrompt = (cand, label) => `Independently verify a candidate implementation. Trust nothing its author claimed. Your job is to find out whether it is actually correct, and to break it if you can.

${specText}

Setup: git checkout --detach ${cand.sha}

Do all of this:
1. Test files must be exactly as the test author left them: git diff --stat ${tests.testsSha} ${cand.sha} -- ${tests.testFiles.join(' ')}
   Any difference means the implementer edited the tests: set testFilesUntouched to false.
2. Run: ${spec.testCommand}
   Report the real result in testsPass and paste the relevant output (failures in full) in testOutput.
3. Try to break it. Read the diff (git diff ${tests.baseSha} ${cand.sha}) and look for inputs or states where an acceptance criterion is violated, or where valid input crashes. Write a throwaway test or script and RUN it.
   A defect counts only if you reproduced it: give the criterion violated, the exact reproduction (test code or command), and the observed output. Do not report style opinions, missing features outside the acceptance criteria, or anything you could not reproduce.

Do not fix anything and do not commit.`

const repairPrompt = (cand, check, approach) => `A candidate implementation failed independent verification. Fix the implementation.

${specText}

Approach this candidate follows: ${approach}

Setup: git checkout --detach ${cand.sha}

Verification results (verbatim):
- Test files untouched: ${check.testFilesUntouched}${check.testFilesUntouched ? '' : `\n  Restore them first: git checkout ${tests.testsSha} -- ${tests.testFiles.join(' ')}`}
- Test command passed: ${check.testsPass}
- Test output:
${check.testOutput}

Reproduced defects:
${check.defects.map((d, i) => `${i + 1}. Violates: ${d.criterion}\n   Reproduction:\n${d.reproduction}\n   Observed: ${d.observed}`).join('\n') || '(none)'}

Rules:
- Find the root cause of each failure before changing code; do not special-case the reproduction.
- Never edit the test files listed here: ${tests.testFiles.join(', ')}
- Run ${spec.testCommand} and each reproduction until all pass, then commit.
${GIT_RULES}`

const refine = async (first, approach, i) => {
  const label = `attempt-${i + 1}`
  let cand = first
  let rounds = 0
  const history = []
  while (true) {
    const check = await agent(checkPrompt(cand, label), {
      label: `check:${label}${rounds ? `:r${rounds}` : ''}`, phase: 'Check', schema: CHECK, isolation: 'worktree',
    })
    if (!check) return { label, approach, sha: cand.sha, summary: cand.summary, clean: false, rounds, history, lastCheck: null }
    history.push(...check.defects.map(d => ({ label, round: rounds, criterion: d.criterion, observed: d.observed })))
    const clean = check.testsPass && check.testFilesUntouched && check.defects.length === 0
    if (clean || rounds >= MAX_REPAIR) {
      if (!clean) log(`${label}: still failing after ${rounds} repair round(s); dropped`)
      return { label, approach, sha: cand.sha, summary: cand.summary, clean, rounds, history, lastCheck: check }
    }
    rounds++
    const fixed = await agent(repairPrompt(cand, check, approach) + `\nTag name: ${TAG}-${label}`, {
      label: `repair:${label}:r${rounds}`, phase: 'Repair', schema: CANDIDATE, isolation: 'worktree',
    })
    if (!fixed) return { label, approach, sha: cand.sha, summary: cand.summary, clean: false, rounds, history, lastCheck: check }
    cand = fixed
  }
}

const results = (await pipeline(
  approaches,
  (approach, _item, i) => agent(
    `Implement a change so that the tests pass. You are one of several engineers building this independently; each was assigned a different approach, and yours is fixed.

${specText}

Your assigned approach: ${approach}

Setup: git checkout --detach ${tests.testsSha}   (this commit contains the tests, which currently fail)

Rules:
- Follow the assigned approach even if you would have chosen another; the point is to explore different designs.
- Never edit these test files: ${tests.testFiles.join(', ')}. If a test looks wrong, say so in summary and still do not edit it.
- Match the surrounding code's conventions. Build only what the acceptance criteria require.
- Run ${spec.testCommand} and iterate until it passes, then commit.
${GIT_RULES}
Tag name: ${TAG}-attempt-${i + 1}
Report sha, a two-sentence summary of the design, and selfReportedPass.`,
    { label: `attempt-${i + 1}`, phase: 'Attempt', schema: CANDIDATE, isolation: 'worktree' },
  ),
  (cand, approach, i) => refine(cand, approach, i),
)).filter(Boolean)

const defectsFound = results.flatMap(r => r.history)
const clean = results.filter(r => r.clean)
log(`${clean.length}/${approaches.length} attempts survived verification; ${defectsFound.length} defect(s) caught along the way`)

const cleanupNote = `Temporary tags named ${TAG}-* were created; delete them with: git tag -l "${TAG}-*" | xargs git tag -d`

if (!clean.length) {
  return {
    status: 'no_verified_candidate',
    spec,
    tests,
    candidates: results.map(r => ({ label: r.label, approach: r.approach, sha: r.sha, rounds: r.rounds, lastCheck: r.lastCheck })),
    defectsFound,
    note: `Nothing was applied to the working tree. ${cleanupNote}`,
  }
}

// ---------------------------------------------------------------- 6. select
phase('Select')
let winner = clean[0]
let selection = 'only candidate that survived verification'
if (clean.length > 1) {
  const pick = await agent(
    `Several implementations of the same change all pass the tests and survived an attempt to break them. Pick the one to merge. Read each diff; do not edit anything.

${specText}

Candidates:
${clean.map(c => `- ${c.label}: git diff ${tests.testsSha} ${c.sha}\n  approach: ${c.approach}\n  repair rounds needed: ${c.rounds}`).join('\n')}

Prefer, in order: fits the existing codebase's patterns; smallest surface for future bugs; simplest to read; needed fewer repairs. Answer with the winning label exactly as written above and a short reason.`,
    { label: 'select', phase: 'Select', schema: PICK },
  )
  const chosen = pick && clean.find(c => c.label === pick.winner.trim())
  if (chosen) { winner = chosen; selection = pick.reason }
  else selection = 'judge gave no usable pick; took the first clean candidate'
}

// ---------------------------------------------------------------- 7. apply
let applied = null
if (APPLY) {
  phase('Apply')
  applied = await agent(
    `Apply a verified change to the user's real working tree and confirm it there. You are in the real checkout, not a worktree: be careful and do not commit.

1. Run git status --short. If files this change touches (git diff --name-only ${tests.baseSha} ${winner.sha}) have uncommitted modifications, stop: set applied to false and explain in problem. Do not stash, reset, or overwrite the user's work.
2. Apply without committing: git diff --binary ${tests.baseSha} ${winner.sha} | git apply --3way
   If it does not apply cleanly, undo your partial application only, set applied to false, and explain.
3. Run: ${spec.testCommand}   Report the real result and output.
4. Delete the temporary tags: git tag -l "${TAG}-*" and git tag -d each one.
List filesChanged. Leave the changes uncommitted for the user to review.`,
    { label: 'apply', phase: 'Apply', schema: APPLIED },
  )
}

return {
  status: applied ? (applied.applied && applied.testsPass ? 'applied_and_passing' : 'verified_but_apply_failed') : 'verified_not_applied',
  winner: { label: winner.label, approach: winner.approach, sha: winner.sha, summary: winner.summary, repairRounds: winner.rounds },
  selection,
  applied,
  spec,
  testFiles: tests.testFiles,
  candidates: results.map(r => ({ label: r.label, approach: r.approach, sha: r.sha, clean: r.clean, rounds: r.rounds })),
  defectsFound,
  note: applied && applied.applied ? 'Changes are in the working tree, uncommitted.' : cleanupNote,
}
