-- Migration 005: 18+ Age Verification & Legal Consent Audit Framework
-- Architecture: Server-Authoritative Consent Records under DPDP Act 2023
-- IMPORTANT: This migration file is for staging review and MUST NOT be applied directly to production without staging validation.

BEGIN;

-- 1. Create persistent user consent table
CREATE TABLE IF NOT EXISTS public.user_consents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    terms_version TEXT NOT NULL,
    privacy_version TEXT NOT NULL,
    age_18_plus BOOLEAN NOT NULL DEFAULT false,
    ai_processing_consent BOOLEAN NOT NULL DEFAULT false,
    accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    withdrawn_at TIMESTAMPTZ DEFAULT NULL,
    ip_address TEXT DEFAULT NULL,
    user_agent TEXT DEFAULT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT user_consents_unique_active UNIQUE (user_id, terms_version, privacy_version)
);

-- 2. Indexes for high-throughput consent validation
CREATE INDEX IF NOT EXISTS idx_user_consents_lookup
    ON public.user_consents (user_id, terms_version, privacy_version)
    WHERE withdrawn_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_user_consents_user_id
    ON public.user_consents (user_id);

-- 3. Row Level Security (RLS) Configuration
ALTER TABLE public.user_consents ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read only their own consent rows
DROP POLICY IF EXISTS "Users can read own consent" ON public.user_consents;
CREATE POLICY "Users can read own consent"
    ON public.user_consents
    FOR SELECT
    TO authenticated
    USING ((SELECT auth.uid()) = user_id);

-- Drop any previous update policy to prevent direct browser mutation of consent records
DROP POLICY IF EXISTS "Users can withdraw own consent" ON public.user_consents;

-- Revoke direct mutation from untrusted browser roles (Authenticated has SELECT-only)
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.user_consents FROM anon, authenticated;
GRANT SELECT ON TABLE public.user_consents TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.user_consents TO service_role;

-- 4. Hardened Security Definer Consent Recording RPC
-- Derives user identity strictly from auth.uid() when invoked by authenticated users.
CREATE OR REPLACE FUNCTION public.record_user_consent(
    p_terms_version TEXT,
    p_privacy_version TEXT,
    p_age_18_plus BOOLEAN,
    p_ai_processing_consent BOOLEAN,
    p_ip_address TEXT DEFAULT NULL,
    p_user_agent TEXT DEFAULT NULL,
    p_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_calling_uid UUID;
    v_effective_uid UUID;
    v_consent_id UUID;
    v_accepted_at TIMESTAMPTZ;
    v_clean_terms TEXT;
    v_clean_privacy TEXT;
BEGIN
    -- Derive calling user identity from auth context
    v_calling_uid := (SELECT auth.uid());

    -- If called by authenticated user, enforce auth.uid() identity
    -- If called by service_role (v_calling_uid is NULL), allow explicit p_user_id
    IF v_calling_uid IS NOT NULL THEN
        v_effective_uid := v_calling_uid;
    ELSIF p_user_id IS NOT NULL THEN
        v_effective_uid := p_user_id;
    ELSE
        RETURN jsonb_build_object(
            'success', false,
            'error', 'UNAUTHORIZED',
            'error_message', 'Authentication required to record consent.'
        );
    END IF;

    -- Validate explicit affirmative inputs
    IF p_age_18_plus IS NOT TRUE THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'INVALID_AGE',
            'error_message', 'Confirmation of age 18 or older is mandatory.'
        );
    END IF;

    IF p_ai_processing_consent IS NOT TRUE THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'INVALID_CONSENT',
            'error_message', 'AI data processing consent is mandatory.'
        );
    END IF;

    v_clean_terms := pg_catalog.btrim(COALESCE(p_terms_version, ''));
    v_clean_privacy := pg_catalog.btrim(COALESCE(p_privacy_version, ''));

    IF v_clean_terms = '' OR v_clean_privacy = '' THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'INVALID_VERSION',
            'error_message', 'Terms and privacy versions must be specified.'
        );
    END IF;

    v_accepted_at := pg_catalog.now();

    -- Upsert consent record: resets withdrawn_at if re-consenting
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
        v_effective_uid,
        v_clean_terms,
        v_clean_privacy,
        true,
        true,
        v_accepted_at,
        NULL,
        p_ip_address,
        p_user_agent
    )
    ON CONFLICT (user_id, terms_version, privacy_version)
    DO UPDATE SET
        age_18_plus = true,
        ai_processing_consent = true,
        accepted_at = v_accepted_at,
        withdrawn_at = NULL,
        ip_address = EXCLUDED.ip_address,
        user_agent = EXCLUDED.user_agent
    RETURNING id INTO v_consent_id;

    RETURN jsonb_build_object(
        'success', true,
        'consent_id', v_consent_id,
        'user_id', v_effective_uid,
        'terms_version', v_clean_terms,
        'privacy_version', v_clean_privacy,
        'accepted_at', v_accepted_at
    );
EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'DATABASE_ERROR',
            'error_message', SQLERRM
        );
END;
$$;

-- Revoke execute from public, anon, and authenticated; grant to service_role only
REVOKE ALL ON FUNCTION public.record_user_consent(TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_user_consent(TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT, TEXT, UUID) TO service_role;

COMMIT;
