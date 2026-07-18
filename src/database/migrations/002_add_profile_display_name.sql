-- Block 4 Phase 2: human-readable name for a tenant/profile, shown in the dashboard's
-- Pending Approvals / Tenant Management roster. Populated from Baileys' groupMetadata().subject
-- when a new WhatsApp group is detected; nullable for tenants created before this column existed.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS display_name TEXT;

UPDATE profiles SET display_name = 'Family Core' WHERE tenant_id = 'family_core' AND display_name IS NULL;

-- Guards against a race: two messages from a brand-new group arriving before the first
-- pending-profile INSERT completes could otherwise both see "no profile yet" and each create
-- one, producing two tenant_ids for the same group_jid.
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_group_jid_unique ON profiles(group_jid) WHERE group_jid IS NOT NULL;
