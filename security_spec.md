# Firestore Security Specification

## 1. Data Invariants
- Every `/users/{userId}` document belongs exclusively to `userId == request.auth.uid` and stores zero PII (`email`, `phone`).
- Sensitive PII (`email`, `phone`) is strictly isolated in `/users/{userId}/private/info` and readable/writable only by the verified owner (`request.auth.uid == userId`).
- Parent-existence gate: writing to `/users/{userId}/private/{docId}` requires the parent `/users/{userId}` document to exist (or be created in the same batch).
- Timestamps (`createdAt`, `updatedAt`) are enforced against `request.time`; `createdAt` and `uid` are immutable after creation.

## 2. Adversarial "Dirty Dozen" Payloads
1. Unauthenticated read/write to `/users/uid1`.
2. Unverified account write when `email_verified == false` and provider is unverified.
3. Cross-user read (`auth.uid = uid2`) on `/users/uid1/private/info` (PII leak test).
4. Cross-user write (`auth.uid = uid2`) creating `/users/uid1`.
5. Shadow field injection (`isAdmin: true`, `role: "admin"`) on create or update.
6. Document ID poisoning (`userId` > 128 chars or containing invalid characters).
7. Oversized `displayName` (> 80 chars) or `phone` (> 24 chars) payload.
8. Invalid `phone` string containing letters/scripts (`<script>`).
9. Mismatched `uid` field (`data.uid != request.auth.uid`).
10. Client-forged `createdAt` or `updatedAt` != `request.time`.
11. Mutating immutable `createdAt` or `uid` during update.
12. Collection-wide `list` scraping of `/users` or `/users/{userId}/private`.
