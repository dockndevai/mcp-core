# Changelog

## [0.2.0] - 2026-11-11

### Security
- **Approval no longer fails open on timeout.** `elicitInput` used the MCP SDK's default 60 s request
  timeout and the `catch` fell through to `{ approved: true }`, so a prompt nobody answered auto-approved a
  destructive operation. A timeout is now a refusal; the wait defaults to 5 minutes (`approvalTimeoutMs`).

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
