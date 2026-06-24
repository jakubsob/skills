# Skills

[![skills.sh](https://skills.sh/b/jakubsob/skills)](https://skills.sh/jakubsob/skills)

Jakub Sobolewski's agent skills for [Claude Code](https://claude.com/claude-code)
and other skills.sh-compatible agents.

## Available skills

| Skill                              | Description                                                                                                                                          |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| [testing](skills/testing/SKILL.md) | Write and review tests that match a project's conventions, or do test-first development (TDD). Routes to framework-specific guidance (e.g. FastAPI). |

## Installation

Install with the [`skills`](https://www.skills.sh) CLI. No global install needed — `npx` runs it on demand.

Install the whole repo:

```bash
npx skills add jakubsob/skills
```

The CLI copies the skill into your agent's skills directory (for Claude Code, `~/.claude/skills/`). Restart your session, or start a new one, to pick it up.

## Usage

Once installed, the agent loads a skill automatically when your request matches its description. You can also invoke one explicitly — for example, type `/testing` in Claude Code, or just ask to "write tests" / "do TDD".
