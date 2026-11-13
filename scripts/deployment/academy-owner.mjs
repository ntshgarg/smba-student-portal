// The owner rule of the manual handover scripts; mirrors
// scripts/database/reset-academy.ts. PLATFORM_OWNER_ACADEMY_ID repeats
// lib/auth/identity.ts's PLATFORM_ADMIN_ACADEMY_ID (plain node cannot import TS).

export const PLATFORM_OWNER_ACADEMY_ID = "SMBA-ADMIN-0001"

export const soleOwnerQuery = `
  SELECT a.id AS id, a.full_name AS fullName, u.username AS username
  FROM accounts a
  LEFT JOIN auth_users u ON u.id = a.id
  WHERE a.role = 'platform_admin'
    AND a.approval_status = 'approved'
    AND a.archived_at IS NULL
`
