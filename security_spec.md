# Security Specification for Sparky

## 1. Data Invariants
- A user's progress must be associated with their Google UID.
- Total hearts cannot exceed 3.
- Partial updates are allowed for Stars and Hearts, but not for UID.
- Review questions should only contain valid Question objects.

## 2. Dirty Dozen Payloads (Targeting /users/{userId})

1. **Identity Spoofing**: `{"uid": "attacker_id", "stars": 99999}` (Attempting to write to another user's doc).
2. **Resource Poisoning**: `{"uid": "user123", "junk": "A".repeat(1024 * 1024)}` (Shadow update with huge data).
3. **Privilege Escalation**: `{"isAdmin": true}` (Adding unauthorized fields).
4. **Value Poisoning**: `{"hearts": -5}` (Invalid heart count).
5. **State Shortcut**: `{"currentMission": "VictoryTrophy"}` (Manually completing a mission).
6. **Immutable Violation**: `{"uid": "new_uid"}` (Changing the owner ID of a document).
7. **Type Mismatch**: `{"stars": "LOTS"}` (Writing string to integer field).
8. **Shadow Field Injection**: `{"stars": 10, "isVerified": true}`.
9. **Massive Array Injection**: `{"wrongAnswers": [...Array(5000).fill({})]}` (Trying to hit document size limits).
10. **Auth Bypass**: Attempting write without `request.auth.token.email_verified == true`.
11. **PII Blanket Read**: Trying to read all users collection as a guest.
12. **Conflict ID**: Creating user doc where document ID != `request.auth.uid`.

## 3. Test Runner (Conceptual)
All the above payloads will be denied by the ruleset.
- `update` blocks use `affectedKeys().hasOnly()` gates.
- `create` blocks enforce strict key size and content.
- `isOwner()` helper enforces `request.auth.uid == userId`.
