# Changelog

## [0.2.0] - 2026-11-11

### Security
- **Approval no longer fails open on timeout.** `elicitInput` used the MCP SDK's default 60 s request
  timeout and the `catch` fell through to `{ approved: true }`, so a prompt nobody answered auto-approved a
  destructive operation. A timeout is now a refusal; the wait defaults to 5 minutes (`approvalTimeoutMs`).

- **The approval prompt is fully reviewable.** It used to cut the arguments at 1500 characters, so a human
  could approve a long SQL statement or script after seeing only a (possibly padded) prefix. Arguments up to
  16 000 characters are now shown in full; beyond that the action is **refused** ("too long to review")
  unless the tool declares `summarizeLargeArgs` for an unreadable payload (file contents, base64).
- Secret-key redaction in prompts/fingerprints is matched on whole words: `bypass`, `tokenizer`, `keyword`
  are no longer shown as `[redacted]`; `passwordHash`, `accessToken`, `x-api-key` still are.

### Added
- `makeConfirmer(server, options)` — `requireHuman` (no flags-only fallback), `audit`, `name`, `approvalTimeoutMs`.
- `Confirmer.forCall(tool, args)` — approvals carry the tool, the exact secret-redacted arguments and a
  fingerprint; `buildServer` binds it per call. Approval receipts go to the audit log (`"audit":"approval"`).
- `ConfirmRequest.probe` — pins a resource version across the prompt and refuses the action if it changed.
- `ConfirmRequest.typed` — require the human to type the target name.
- `canonicalArgs`, `fingerprint`, `ApprovalReceipt`, `ConfirmerOptions` exports.

### Changed
- `ConfirmOutcome` (approved) now includes a `receipt`. `Confirmer` has a new `forCall` member.

Tracking issue: #1
