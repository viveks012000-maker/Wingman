-- ============================================================================
-- MY WINGMAN SUPABASE POSTGRES MIGRATION: 004_user_consent_and_age_verification.sql
-- PROPOSED MIGRATION FOR SERVER-SIDE 18+ AGE AND PRIVACY CONSENT VERIFICATION
-- NOTE: In compliance with project security invariants, this file is authored for
-- staging/review and MUST NOT be automatically applied directly to production.
-- ============================================================================

BEGIN;

-- 1. Create user_consents table for persistent legal consent evidence
CREATE TABLE IF NOT EXISTS public.user_consents (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    terms_version TEXT NOT NULL,
    privacy_version TEXT NOT NULL,
    age_18_plus BOOLEAN NOT NULL DEFAULT FALSE,
    ai_processing_consent BOOLEAN NOT NULL DEFAULT FALSE,
    accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    withdrawn_at TIMESTAMPTZ DEFAULT NULL,
    ip_address TEXT DEFAULT NULL,
    user_agent TEXT DEFAULT NULL,
    CONSTRAINT unique_user_consent_version UNIQUE (user_id, terms_version, privacy_version)
);

-- Index for fast user lookup
CREATE INDEX IF NOT EXISTS idx_user_consents_user_id ON public.user_consents(user_id);
CREATE INDEX IF NOT EXISTS idx_user_consents_active ON public.user_consents(user_id, terms_version, privacy_version) WHERE withdrawn_at IS NULL;

-- 2. Enable Row Level Security
ALTER TABLE public.user_consents ENABLE ROW LEVEL SECURITY;

-- 3. RLS Policies: Authenticated users can view their own consent records
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can view own consent records') THEN
        CREATE POLICY "Users can view own consent records" 
            ON public.user_consents 
            FOR SELECT 
            USING (auth.uid() = user_id);
    END IF;
END $$;

-- 4. Secure RPC function to record user consent
CREATE OR REPLACE FUNCTION record_user_consent(
    p_user_id UUID,
    p_terms_version TEXT,
    p_privacy_version TEXT,
    p_age_18_plus BOOLEAN,
    p_ai_processing_consent BOOLEAN,
    p_ip_address TEXT DEFAULT NULL,
    p_user_agent TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_consent_id BIGINT;
    v_accepted_at TIMESTAMPTZ;
BEGIN
    -- Input validation
    IF p_user_id IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'Invalid user ID.');
    END IF;

    IF p_age_18_plus IS NOT TRUE THEN
        RETURN json_build_object('success', false, 'error', 'Age 18+ confirmation is mandatory.');
    END IF;

    IF p_ai_processing_consent IS NOT TRUE THEN
        RETURN json_build_object('success', false, 'error', 'AI processing consent is mandatory.');
    END IF;

    INSERT INTO public.user_consents (
        user_id,
        terms_version,
        privacy_version,
        age_18_plus,
        ai_processing_consent,
        accepted_at,
        withdrawn_at,
        ip_address,
        user_agent
    )
    VALUES (
        p_user_id,
        COALESCE(pg_catalog.btrim(p_terms_version), '2026.1'),
        COALESCE(pg_catalog.btrim(p_privacy_version), '2026.1'),
        p_age_18_plus,
        p_ai_processing_consent,
        NOW(),
        NULL,
        p_ip_address,
        p_user_agent
    )
    ON CONFLICT (user_id, terms_version, privacy_version)
    DO UPDATE SET
        age_18_plus = EXCLUDED.age_18_plus,
        ai_processing_consent = EXCLUDED.ai_processing_consent,
        accepted_at = NOW(),
        withdrawn_at = NULL,
        ip_address = COALESCE(EXCLUDED.ip_address, public.user_consents.ip_address),
        user_agent = COALESCE(EXCLUDED.user_agent, public.user_consents.user_agent)
    RETURNING id, accepted_at INTO v_consent_id, v_accepted_at;

    RETURN json_build_object(
        'success', true,
        'consent_id', v_consent_id,
        'accepted_at', v_accepted_at,
        'terms_version', COALESCE(pg_catalog.btrim(p_terms_version), '2026.1'),
        'privacy_version', COALESCE(pg_catalog.btrim(p_privacy_version), '2026.1')
    );
END;
$$;

-- 5. Revoke direct execute from untrusted roles, grant to service_role and authenticated
REVOKE EXECUTE ON FUNCTION record_user_consent(UUID, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION record_user_consent(UUID, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT) TO authenticated, service_role;

COMMIT;
