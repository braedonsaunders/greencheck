# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| v0.x    | ✅        |

## Reporting a Vulnerability

If you discover a security vulnerability in greencheck, please report it responsibly:

1. **Do not** open a public GitHub issue.
2. Email **security@braedonsaunders.dev** with details of the vulnerability.
3. Include steps to reproduce if possible.

You should receive a response within 48 hours. We will work with you to understand the issue and coordinate a fix before any public disclosure.

## Security Considerations

greencheck operates in GitHub Actions with elevated permissions (contents:write, actions:read). Key security notes:

- **Tokens**: `trigger-token` should be a fine-grained PAT or GitHub App token scoped to the minimum required permissions.
- **Protected files**: Use `safety.never-touch-files` to prevent the agent from modifying sensitive files like `.env`, lockfiles, or CI configs.
- **Cost limits**: Always set `max-cost` and `timeout` to prevent runaway agent invocations.
- **Auto-merge**: Disabled by default. When enabled, requires PR approval and optional label gating.
- **Stale context**: greencheck refuses to operate if the branch has advanced past the failed commit.
