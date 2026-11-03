-- PharmaCore — Migration 0001: foundation
-- Canonical names per docs/02-requirements/detailed/07-CROSS-REVIEW-CONFLICTS.md §4
-- Engineering rules: money = BIGINT minor + currency; qty = BIGINT SSU; append-only ledgers; RLS by tenant.
-- Target: PostgreSQL 16+ (works on 17).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================================ enums
CREATE TYPE currency_code AS ENUM ('YER_OLD', 'YER_NEW', 'SAR', 'USD');
CREATE TYPE document_status AS ENUM ('DRAFT', 'HELD', 'PENDING_APPROVAL', 'POSTED', 'REVERSED', 'CANCELLED', 'EXPIRED');
CREATE TYPE lot_manual_status AS ENUM ('NONE', 'QUARANTINED', 'BLOCKED', 'RETURNED_TO_SUPPLIER', 'DESTROYED');
CREATE TYPE lot_source_type AS ENUM ('OFFICIAL', 'PARALLEL');
CREATE TYPE stock_movement_type AS ENUM ('OPENING', 'RECEIPT', 'SALE', 'SALE_RETURN', 'PURCHASE_RETURN', 'ADJUSTMENT', 'TRANSFER_OUT', 'TRANSFER_IN', 'STOCKTAKE');
CREATE TYPE payment_method AS ENUM ('CASH', 'CARD', 'WALLET', 'CREDIT');
CREATE TYPE shift_status AS ENUM ('OPEN', 'CLOSED');
CREATE TYPE account_side AS ENUM ('DEBIT', 'CREDIT');
CREATE TYPE rx_requirement AS ENUM ('NONE', 'RX', 'RX_RETAIN');
CREATE TYPE controlled_class AS ENUM ('NONE', 'PSYCHOTROPIC', 'NARCOTIC', 'PRECURSOR');
CREATE TYPE official_price_policy AS ENUM ('BLOCK', 'BLOCK_WITH_OVERRIDE', 'WARN');

-- ============================================================================ helpers
-- Tenant context: SET LOCAL app.tenant_id = '<uuid>' per transaction (application layer).
CREATE OR REPLACE FUNCTION app_tenant_id() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); NEW.version = OLD.version + 1; RETURN NEW; END $$;

-- Append-only guard (ENGINEERING-RULES B: ledgers are immutable)
CREATE OR REPLACE FUNCTION deny_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'append_only_violation: table % is append-only (op %)', TG_TABLE_NAME, TG_OP
  USING ERRCODE = 'P0001'; END $$;

-- Posted documents are immutable except the single transition POSTED -> REVERSED with reversal link
CREATE OR REPLACE FUNCTION protect_posted_document() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('POSTED', 'REVERSED') THEN
      RAISE EXCEPTION 'posted_document_immutable: % % cannot be deleted', TG_TABLE_NAME, OLD.id USING ERRCODE = 'P0002';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'REVERSED' THEN
    RAISE EXCEPTION 'posted_document_immutable: % % is reversed and frozen', TG_TABLE_NAME, OLD.id USING ERRCODE = 'P0002';
  END IF;
  IF OLD.status = 'POSTED' THEN
    IF NOT (NEW.status = 'REVERSED' AND NEW.reversed_by_id IS NOT NULL
            AND (to_jsonb(NEW) - 'status' - 'reversed_by_id' - 'reversed_at' - 'reversal_reason' - 'updated_at' - 'version')
              = (to_jsonb(OLD) - 'status' - 'reversed_by_id' - 'reversed_at' - 'reversal_reason' - 'updated_at' - 'version')) THEN
      RAISE EXCEPTION 'posted_document_immutable: % % is posted; only POSTED->REVERSED with reversed_by_id is allowed', TG_TABLE_NAME, OLD.id
        USING ERRCODE = 'P0002';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- ============================================================================ tenancy & identity
CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name_ar text NOT NULL,
  name_en text NOT NULL,
  base_currency currency_code NOT NULL,
  base_currency_locked_at timestamptz,              -- set after first POSTED document (D-027)
  official_price_policy official_price_policy NOT NULL DEFAULT 'BLOCK_WITH_OVERRIDE',  -- D-029
  discount_posting text NOT NULL DEFAULT 'NET' CHECK (discount_posting IN ('NET','GROSS')),
  cash_round_step_minor bigint NOT NULL DEFAULT 0 CHECK (cash_round_step_minor >= 0),
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  username text NOT NULL,
  display_name text NOT NULL,
  password_hash text NOT NULL,                       -- argon2id (infra)
  pin_hash text,                                     -- manager PIN for elevation
  locale text NOT NULL DEFAULT 'ar' CHECK (locale IN ('ar','en')),
  is_active boolean NOT NULL DEFAULT true,
  password_changed_at timestamptz NOT NULL DEFAULT now(),
  failed_logins integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, username)
);

CREATE TABLE roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  code text NOT NULL,                                -- OWNER, MANAGER, CASHIER... or custom
  name_ar text NOT NULL,
  name_en text NOT NULL,
  is_system boolean NOT NULL DEFAULT false,
  permissions text[] NOT NULL DEFAULT '{}',          -- resource.action keys
  limits jsonb NOT NULL DEFAULT '{}'::jsonb,         -- {"max_discount_bp": 500, ...}
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, code)
);

CREATE TABLE user_roles (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE user_permission_overrides (             -- D-030 per-user allow/deny + numeric limits
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission text NOT NULL,
  effect text NOT NULL CHECK (effect IN ('ALLOW','DENY')),
  limit_value bigint,
  PRIMARY KEY (user_id, permission)
);

CREATE TABLE refresh_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  device_id text,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================ currencies & FX (D-027)
CREATE TABLE exchange_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  from_currency currency_code NOT NULL,
  to_currency currency_code NOT NULL,
  buy_rate_scaled bigint NOT NULL CHECK (buy_rate_scaled > 0),    -- scale 1e6
  sell_rate_scaled bigint NOT NULL CHECK (sell_rate_scaled > 0),
  effective_from timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_currency <> to_currency)
);
CREATE INDEX exchange_rates_lookup ON exchange_rates (tenant_id, from_currency, to_currency, effective_from DESC);

-- ============================================================================ catalog (D-026)
CREATE TABLE item_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  parent_id uuid REFERENCES item_categories(id),
  name_ar text NOT NULL, name_en text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1
);

CREATE TABLE items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  item_code text NOT NULL,
  trade_name_ar text NOT NULL,
  trade_name_en text NOT NULL,
  generic_name text,                                 -- scientific / active ingredient
  strength text,
  dosage_form text,
  manufacturer text,
  agent_name text,                                   -- الوكيل
  country_of_origin text,
  category_id uuid REFERENCES item_categories(id),
  rx_required rx_requirement NOT NULL DEFAULT 'NONE',
  controlled_class controlled_class NOT NULL DEFAULT 'NONE',
  track_expiry boolean NOT NULL DEFAULT true,
  requires_cold_chain boolean NOT NULL DEFAULT false,
  is_returnable boolean NOT NULL DEFAULT true,
  tax_bp integer NOT NULL DEFAULT 0 CHECK (tax_bp >= 0 AND tax_bp <= 10000),
  min_stock_ssu bigint NOT NULL DEFAULT 0 CHECK (min_stock_ssu >= 0),
  max_stock_ssu bigint CHECK (max_stock_ssu IS NULL OR max_stock_ssu >= min_stock_ssu),
  reorder_point_ssu bigint CHECK (reorder_point_ssu IS NULL OR reorder_point_ssu >= 0),
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, item_code)
);
CREATE INDEX items_search_ar ON items USING gin (to_tsvector('simple', coalesce(trade_name_ar,'') || ' ' || coalesce(generic_name,'')));
CREATE INDEX items_search_en ON items USING gin (to_tsvector('simple', coalesce(trade_name_en,'') || ' ' || coalesce(generic_name,'')));

CREATE TABLE item_units (                            -- flexible UOM ladder
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  item_id uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  name_ar text NOT NULL, name_en text NOT NULL,
  factor_to_ssu bigint NOT NULL CHECK (factor_to_ssu >= 1),
  level smallint NOT NULL CHECK (level >= 1),
  is_ssu boolean NOT NULL DEFAULT false,
  can_sell boolean NOT NULL DEFAULT true,
  can_purchase boolean NOT NULL DEFAULT true,
  is_default_sale boolean NOT NULL DEFAULT false,
  is_default_purchase boolean NOT NULL DEFAULT false,
  is_stock_display boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  factor_locked_at timestamptz,                      -- set on first stock movement (D-026)
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1,
  UNIQUE (item_id, level),
  CHECK ((is_ssu AND factor_to_ssu = 1) OR NOT is_ssu)
);
CREATE UNIQUE INDEX item_units_one_ssu ON item_units (item_id) WHERE is_ssu;
CREATE UNIQUE INDEX item_units_one_default_sale ON item_units (item_id) WHERE is_default_sale;
CREATE UNIQUE INDEX item_units_one_default_purchase ON item_units (item_id) WHERE is_default_purchase;

-- D-026: factor_to_ssu cannot change once locked
CREATE OR REPLACE FUNCTION protect_locked_unit_factor() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.factor_locked_at IS NOT NULL AND NEW.factor_to_ssu <> OLD.factor_to_ssu THEN
    RAISE EXCEPTION 'unit_factor_locked: item_unit % has stock history; add a new unit instead', OLD.id USING ERRCODE = 'P0003';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER item_units_factor_lock BEFORE UPDATE ON item_units FOR EACH ROW EXECUTE FUNCTION protect_locked_unit_factor();

CREATE TABLE item_barcodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  item_id uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES item_units(id) ON DELETE CASCADE,
  barcode text NOT NULL,
  normalized_barcode text NOT NULL,                  -- GTIN-14 zero-padded for GS1 types
  barcode_type text NOT NULL CHECK (barcode_type IN ('EAN13','EAN8','UPCA','GTIN14','CODE128','INTERNAL','GS1_DATAMATRIX')),
  source text NOT NULL DEFAULT 'MANUFACTURER' CHECK (source IN ('MANUFACTURER','INTERNAL','GS1')),
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX item_barcodes_lookup ON item_barcodes (tenant_id, normalized_barcode);

CREATE TABLE price_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  code text NOT NULL, name_ar text NOT NULL, name_en text NOT NULL,
  currency currency_code NOT NULL,
  kind text NOT NULL CHECK (kind IN ('RETAIL','WHOLESALE','SPECIAL','CUSTOMER_GROUP','CUSTOMER')),
  priority integer NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, code)
);

CREATE TABLE price_list_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  price_list_id uuid NOT NULL REFERENCES price_lists(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES item_units(id),
  unit_price_minor bigint NOT NULL CHECK (unit_price_minor >= 0),
  min_price_minor bigint CHECK (min_price_minor IS NULL OR min_price_minor >= 0),
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);
CREATE INDEX price_list_items_lookup ON price_list_items (price_list_id, item_id, unit_id, effective_from DESC);

CREATE TABLE price_history (                         -- append-only
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  item_id uuid NOT NULL, unit_id uuid NOT NULL, price_list_id uuid,
  old_price_minor bigint, new_price_minor bigint NOT NULL,
  reason text, changed_by uuid, changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER price_history_immutable BEFORE UPDATE OR DELETE ON price_history FOR EACH ROW EXECUTE FUNCTION deny_mutation();

CREATE TABLE official_prices (                       -- D-029: regulator public price (YER)
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  item_id uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES item_units(id),
  currency currency_code NOT NULL,
  public_price_minor bigint NOT NULL CHECK (public_price_minor >= 0),
  source_list_ref text,                              -- e.g. "SBDMA list 2025-08"
  effective_from date NOT NULL,
  effective_to date,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX official_prices_lookup ON official_prices (item_id, unit_id, effective_from DESC);

-- ============================================================================ parties
CREATE TABLE customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  code text NOT NULL, name text NOT NULL, phone text, address text,
  price_list_id uuid REFERENCES price_lists(id),
  credit_limit_minor bigint NOT NULL DEFAULT 0 CHECK (credit_limit_minor >= 0),
  credit_currency currency_code,
  is_walk_in boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, code)
);

CREATE TABLE suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  code text NOT NULL, name text NOT NULL, phone text, address text, tax_number text,
  default_currency currency_code,
  payment_terms_days integer NOT NULL DEFAULT 0 CHECK (payment_terms_days >= 0),
  early_payment_days integer, early_payment_bp integer CHECK (early_payment_bp IS NULL OR (early_payment_bp BETWEEN 0 AND 10000)),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, code)
);

-- ============================================================================ inventory
CREATE TABLE locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  code text NOT NULL, name_ar text NOT NULL, name_en text NOT NULL,
  kind text NOT NULL DEFAULT 'SHELF' CHECK (kind IN ('SHELF','FRIDGE','BACKSTORE','QUARANTINE','BRANCH')),
  is_sellable boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, code)
);

CREATE TABLE lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  item_id uuid NOT NULL REFERENCES items(id),
  lot_number text NOT NULL,
  expiry_date date,                                  -- NULL only if items.track_expiry = false (enforced by trigger)
  qty_received_ssu bigint NOT NULL CHECK (qty_received_ssu > 0),
  total_cost_minor bigint NOT NULL CHECK (total_cost_minor >= 0),   -- source of truth for cost (base currency)
  cost_currency currency_code NOT NULL,
  supplier_id uuid REFERENCES suppliers(id),
  source_type lot_source_type NOT NULL DEFAULT 'OFFICIAL',
  printed_public_price_minor bigint CHECK (printed_public_price_minor IS NULL OR printed_public_price_minor >= 0),
  manual_status lot_manual_status NOT NULL DEFAULT 'NONE',
  status_reason text,
  status_changed_by uuid REFERENCES users(id),
  status_changed_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT now(),
  source_document_type text, source_document_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1
);
CREATE INDEX lots_fefo ON lots (tenant_id, item_id, expiry_date NULLS LAST, received_at, id);
CREATE INDEX lots_expiry ON lots (tenant_id, expiry_date) WHERE manual_status = 'NONE';

-- Only status fields may change on a lot after creation (facts are immutable)
CREATE OR REPLACE FUNCTION protect_lot_facts() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'manual_status' - 'status_reason' - 'status_changed_by' - 'status_changed_at' - 'printed_public_price_minor' - 'updated_at' - 'version')
     <> (to_jsonb(OLD) - 'manual_status' - 'status_reason' - 'status_changed_by' - 'status_changed_at' - 'printed_public_price_minor' - 'updated_at' - 'version') THEN
    RAISE EXCEPTION 'lot_facts_immutable: lot % facts (qty/cost/expiry/item) cannot change', OLD.id USING ERRCODE = 'P0004';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER lots_protect_facts BEFORE UPDATE ON lots FOR EACH ROW EXECUTE FUNCTION protect_lot_facts();
CREATE TRIGGER lots_no_delete BEFORE DELETE ON lots FOR EACH ROW EXECUTE FUNCTION deny_mutation();

CREATE OR REPLACE FUNCTION check_lot_expiry_required() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE req boolean;
BEGIN
  SELECT track_expiry INTO req FROM items WHERE id = NEW.item_id;
  IF req AND NEW.expiry_date IS NULL THEN
    RAISE EXCEPTION 'lot_expiry_required: item % tracks expiry', NEW.item_id USING ERRCODE = 'P0005';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER lots_expiry_required BEFORE INSERT ON lots FOR EACH ROW EXECUTE FUNCTION check_lot_expiry_required();

CREATE TABLE stock_movements (                       -- APPEND-ONLY ledger
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  item_id uuid NOT NULL REFERENCES items(id),
  lot_id uuid NOT NULL REFERENCES lots(id),
  location_id uuid NOT NULL REFERENCES locations(id),
  movement_type stock_movement_type NOT NULL,
  qty_delta_ssu bigint NOT NULL CHECK (qty_delta_ssu <> 0),
  unit_cost_minor_snapshot bigint NOT NULL CHECK (unit_cost_minor_snapshot >= 0),
  cost_currency currency_code NOT NULL,
  unit_id uuid REFERENCES item_units(id),
  factor_snapshot bigint CHECK (factor_snapshot IS NULL OR factor_snapshot >= 1),
  qty_in_unit bigint,
  document_type text NOT NULL,
  document_id uuid NOT NULL,
  document_line_id uuid,
  business_date date NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id),
  device_id text,
  CHECK (
    (movement_type IN ('OPENING','RECEIPT','SALE_RETURN','TRANSFER_IN') AND qty_delta_ssu > 0) OR
    (movement_type IN ('SALE','PURCHASE_RETURN','TRANSFER_OUT') AND qty_delta_ssu < 0) OR
    (movement_type IN ('ADJUSTMENT','STOCKTAKE'))
  )
);
CREATE INDEX stock_movements_lot ON stock_movements (lot_id, occurred_at);
CREATE INDEX stock_movements_item_date ON stock_movements (tenant_id, item_id, business_date);
CREATE INDEX stock_movements_doc ON stock_movements (document_type, document_id);
CREATE TRIGGER stock_movements_immutable BEFORE UPDATE OR DELETE ON stock_movements FOR EACH ROW EXECUTE FUNCTION deny_mutation();

-- Rule: no SALE from an expired lot (expired from the START of expiry_date — D-027 cross-review #9)
CREATE OR REPLACE FUNCTION check_not_expired_on_sale() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE exp date; ms lot_manual_status;
BEGIN
  IF NEW.movement_type = 'SALE' THEN
    SELECT expiry_date, manual_status INTO exp, ms FROM lots WHERE id = NEW.lot_id;
    IF exp IS NOT NULL AND exp <= NEW.business_date THEN
      RAISE EXCEPTION 'lot_expired: cannot sell from lot % (expiry %, business date %)', NEW.lot_id, exp, NEW.business_date USING ERRCODE = 'P0006';
    END IF;
    IF ms <> 'NONE' THEN
      RAISE EXCEPTION 'lot_not_sellable: lot % status %', NEW.lot_id, ms USING ERRCODE = 'P0007';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER stock_movements_not_expired BEFORE INSERT ON stock_movements FOR EACH ROW EXECUTE FUNCTION check_not_expired_on_sale();

-- Rule: lock the unit factor on first use (D-026)
CREATE OR REPLACE FUNCTION lock_unit_factor_on_use() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.unit_id IS NOT NULL THEN
    UPDATE item_units SET factor_locked_at = now() WHERE id = NEW.unit_id AND factor_locked_at IS NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER stock_movements_lock_unit AFTER INSERT ON stock_movements FOR EACH ROW EXECUTE FUNCTION lock_unit_factor_on_use();

-- Rule: no negative lot balance (constraint trigger, deferred to end of transaction so multi-row docs can post)
CREATE OR REPLACE FUNCTION check_lot_balance_non_negative() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE bal bigint; allow boolean;
BEGIN
  SELECT COALESCE(SUM(qty_delta_ssu),0) INTO bal FROM stock_movements WHERE lot_id = NEW.lot_id AND location_id = NEW.location_id;
  IF bal < 0 THEN
    SELECT COALESCE((settings->>'allow_negative_stock')::boolean, false) INTO allow FROM tenants WHERE id = NEW.tenant_id;
    IF NOT allow THEN
      RAISE EXCEPTION 'insufficient_stock: lot % at location % would go to %', NEW.lot_id, NEW.location_id, bal USING ERRCODE = 'P0008';
    END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER stock_movements_balance AFTER INSERT ON stock_movements
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_lot_balance_non_negative();

-- Derived balance view (read model; never written)
CREATE VIEW stock_balances AS
SELECT tenant_id, item_id, lot_id, location_id, SUM(qty_delta_ssu) AS qty_ssu
FROM stock_movements GROUP BY tenant_id, item_id, lot_id, location_id;
-- Views run as their owner by default and would BYPASS RLS → force invoker privileges (PG15+)
ALTER VIEW stock_balances SET (security_invoker = true);

-- ============================================================================ cash & shifts
CREATE TABLE cashboxes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  code text NOT NULL, name_ar text NOT NULL, name_en text NOT NULL,
  kind text NOT NULL DEFAULT 'REGISTER' CHECK (kind IN ('REGISTER','SAFE','BANK','WALLET')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, code)
);

CREATE TABLE shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  cashbox_id uuid NOT NULL REFERENCES cashboxes(id),
  cashier_id uuid NOT NULL REFERENCES users(id),
  device_id text,
  status shift_status NOT NULL DEFAULT 'OPEN',
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  closed_by uuid REFERENCES users(id),
  reopened_by uuid REFERENCES users(id), reopen_reason text,
  opening_float jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{currency, amountMinor}]
  counted_cash jsonb,                                 -- on close
  expected_cash jsonb,                                -- snapshot on close
  variances jsonb,                                    -- [{currency, amountMinor, reason}]
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX shifts_one_open_per_cashier ON shifts (cashier_id) WHERE status = 'OPEN';
CREATE UNIQUE INDEX shifts_one_open_per_cashbox ON shifts (cashbox_id) WHERE status = 'OPEN';

CREATE TABLE cash_movements (                        -- APPEND-ONLY
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  cashbox_id uuid NOT NULL REFERENCES cashboxes(id),
  shift_id uuid REFERENCES shifts(id),
  currency currency_code NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor <> 0),   -- signed
  kind text NOT NULL CHECK (kind IN ('OPENING_FLOAT','SALE','SALE_REFUND','CUSTOMER_PAYMENT','SUPPLIER_PAYMENT','EXPENSE','TRANSFER_IN','TRANSFER_OUT','FX_IN','FX_OUT','OWNER_DRAWING','CAPITAL','ADJUSTMENT')),
  pair_id uuid,                                      -- links the two sides of transfer / FX
  rate_scaled_snapshot bigint,
  document_type text, document_id uuid,
  reason text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id)
);
CREATE INDEX cash_movements_box ON cash_movements (cashbox_id, currency, occurred_at);
CREATE INDEX cash_movements_shift ON cash_movements (shift_id);
CREATE TRIGGER cash_movements_immutable BEFORE UPDATE OR DELETE ON cash_movements FOR EACH ROW EXECUTE FUNCTION deny_mutation();

-- ============================================================================ numbering
CREATE TABLE numbering_series (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  document_type text NOT NULL,
  prefix text NOT NULL DEFAULT '',
  next_number bigint NOT NULL DEFAULT 1,
  padding smallint NOT NULL DEFAULT 6,
  reset_policy text NOT NULL DEFAULT 'NEVER' CHECK (reset_policy IN ('NEVER','YEARLY')),
  period_key text NOT NULL DEFAULT '',
  UNIQUE (tenant_id, document_type, period_key)
);
-- Gapless number allocated under row lock, ONLY at POST time (cross-review risk #7)
CREATE OR REPLACE FUNCTION next_document_number(p_tenant uuid, p_type text, p_period text DEFAULT '') RETURNS text
LANGUAGE plpgsql AS $$
DECLARE n bigint; pfx text; pad smallint;
BEGIN
  INSERT INTO numbering_series (tenant_id, document_type, period_key) VALUES (p_tenant, p_type, p_period) ON CONFLICT DO NOTHING;
  UPDATE numbering_series SET next_number = next_number + 1
   WHERE tenant_id = p_tenant AND document_type = p_type AND period_key = p_period
   RETURNING next_number - 1, prefix, padding INTO n, pfx, pad;
  RETURN pfx || CASE WHEN p_period <> '' THEN p_period || '-' ELSE '' END || lpad(n::text, pad, '0');
END $$;

-- ============================================================================ sales
CREATE TABLE sales_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  number text,                                       -- assigned at POST
  status document_status NOT NULL DEFAULT 'DRAFT',
  customer_id uuid REFERENCES customers(id),
  shift_id uuid REFERENCES shifts(id),
  cashier_id uuid NOT NULL REFERENCES users(id),
  currency currency_code NOT NULL,
  price_list_id uuid REFERENCES price_lists(id),
  business_date date NOT NULL DEFAULT CURRENT_DATE,
  gross_minor bigint NOT NULL DEFAULT 0,
  line_discount_minor bigint NOT NULL DEFAULT 0,
  invoice_discount_minor bigint NOT NULL DEFAULT 0,
  invoice_discount_bp integer,
  net_minor bigint NOT NULL DEFAULT 0,
  tax_minor bigint NOT NULL DEFAULT 0,
  total_minor bigint NOT NULL DEFAULT 0,
  rounding_adjustment_minor bigint NOT NULL DEFAULT 0,
  paid_minor bigint NOT NULL DEFAULT 0,
  credit_minor bigint NOT NULL DEFAULT 0,
  rate_scaled_snapshot bigint,                       -- invoice currency → base at post time
  prescription jsonb,                                -- {patientName, doctor, rxNumber} optional
  notes text,
  idempotency_key text,
  posted_at timestamptz, posted_by uuid REFERENCES users(id),
  reversed_at timestamptz, reversed_by_id uuid, reversal_reason text,
  device_id text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1,
  CHECK (total_minor >= 0 AND net_minor >= 0 AND gross_minor >= 0),
  CHECK (status <> 'POSTED' OR (number IS NOT NULL AND posted_at IS NOT NULL AND shift_id IS NOT NULL))
);
CREATE UNIQUE INDEX sales_invoices_number ON sales_invoices (tenant_id, number) WHERE number IS NOT NULL;
CREATE UNIQUE INDEX sales_invoices_idem ON sales_invoices (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX sales_invoices_date ON sales_invoices (tenant_id, business_date, status);
CREATE TRIGGER sales_invoices_protect BEFORE UPDATE OR DELETE ON sales_invoices FOR EACH ROW EXECUTE FUNCTION protect_posted_document();

CREATE TABLE sales_invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  invoice_id uuid NOT NULL REFERENCES sales_invoices(id) ON DELETE CASCADE,
  line_no integer NOT NULL,
  item_id uuid NOT NULL REFERENCES items(id),
  unit_id uuid NOT NULL REFERENCES item_units(id),
  unit_name_snapshot text NOT NULL,
  factor_snapshot bigint NOT NULL CHECK (factor_snapshot >= 1),
  qty_in_unit bigint NOT NULL CHECK (qty_in_unit > 0),
  ssu_qty bigint NOT NULL CHECK (ssu_qty > 0),
  unit_price_minor bigint NOT NULL CHECK (unit_price_minor >= 0),
  price_source text,
  regulated_unit_price_snapshot bigint,
  gross_minor bigint NOT NULL,
  discount_minor bigint NOT NULL DEFAULT 0,
  discount_breakdown jsonb NOT NULL DEFAULT '[]'::jsonb,
  allocated_invoice_discount_minor bigint NOT NULL DEFAULT 0,
  net_minor bigint NOT NULL,
  tax_bp integer NOT NULL DEFAULT 0,
  tax_minor bigint NOT NULL DEFAULT 0,
  total_minor bigint NOT NULL,
  cost_minor_snapshot bigint,                        -- COGS at post
  UNIQUE (invoice_id, line_no)
);

CREATE TABLE sale_line_lots (                        -- FEFO allocation per line
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  line_id uuid NOT NULL REFERENCES sales_invoice_lines(id) ON DELETE CASCADE,
  lot_id uuid NOT NULL REFERENCES lots(id),
  location_id uuid NOT NULL REFERENCES locations(id),
  ssu_qty bigint NOT NULL CHECK (ssu_qty > 0),
  unit_cost_minor_snapshot bigint NOT NULL,
  fefo_override_by uuid REFERENCES users(id), fefo_override_reason text
);

CREATE TABLE invoice_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  invoice_id uuid NOT NULL REFERENCES sales_invoices(id) ON DELETE CASCADE,
  method payment_method NOT NULL,
  currency currency_code NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  rate_scaled_snapshot bigint,
  amount_in_invoice_currency_minor bigint NOT NULL,
  tendered_minor bigint, change_minor bigint, change_currency currency_code,
  cashbox_id uuid REFERENCES cashboxes(id),
  reference text
);

CREATE TABLE sales_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  number text,
  status document_status NOT NULL DEFAULT 'DRAFT',
  original_invoice_id uuid REFERENCES sales_invoices(id),
  customer_id uuid REFERENCES customers(id),
  shift_id uuid REFERENCES shifts(id),
  cashier_id uuid NOT NULL REFERENCES users(id),
  currency currency_code NOT NULL,
  business_date date NOT NULL DEFAULT CURRENT_DATE,
  refund_total_minor bigint NOT NULL DEFAULT 0 CHECK (refund_total_minor >= 0),
  reason text,
  approved_by uuid REFERENCES users(id),
  posted_at timestamptz, posted_by uuid REFERENCES users(id),
  reversed_at timestamptz, reversed_by_id uuid, reversal_reason text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX sales_returns_number ON sales_returns (tenant_id, number) WHERE number IS NOT NULL;
CREATE TRIGGER sales_returns_protect BEFORE UPDATE OR DELETE ON sales_returns FOR EACH ROW EXECUTE FUNCTION protect_posted_document();

CREATE TABLE sales_return_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  return_id uuid NOT NULL REFERENCES sales_returns(id) ON DELETE CASCADE,
  original_line_id uuid REFERENCES sales_invoice_lines(id),
  item_id uuid NOT NULL REFERENCES items(id),
  lot_id uuid NOT NULL REFERENCES lots(id),
  unit_id uuid NOT NULL REFERENCES item_units(id),
  factor_snapshot bigint NOT NULL, qty_in_unit bigint NOT NULL CHECK (qty_in_unit > 0), ssu_qty bigint NOT NULL CHECK (ssu_qty > 0),
  refund_unit_price_minor bigint NOT NULL CHECK (refund_unit_price_minor >= 0),
  refund_minor bigint NOT NULL,
  cost_minor_snapshot bigint NOT NULL
);

-- ============================================================================ purchasing
CREATE TABLE purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  number text,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PENDING_APPROVAL','APPROVED','PARTIALLY_RECEIVED','RECEIVED','CANCELLED')),
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  currency currency_code NOT NULL,
  rate_scaled_snapshot bigint,
  expected_date date,
  total_minor bigint NOT NULL DEFAULT 0,
  approved_by uuid REFERENCES users(id), approved_at timestamptz,
  notes text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX purchase_orders_number ON purchase_orders (tenant_id, number) WHERE number IS NOT NULL;

CREATE TABLE purchase_order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  order_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  line_no integer NOT NULL,
  item_id uuid NOT NULL REFERENCES items(id),
  unit_id uuid NOT NULL REFERENCES item_units(id),
  factor_snapshot bigint NOT NULL,
  qty_in_unit bigint NOT NULL CHECK (qty_in_unit > 0),
  ssu_qty bigint NOT NULL,
  unit_price_minor bigint NOT NULL CHECK (unit_price_minor >= 0),
  received_ssu bigint NOT NULL DEFAULT 0,
  UNIQUE (order_id, line_no)
);

CREATE TABLE goods_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  number text,
  status document_status NOT NULL DEFAULT 'DRAFT',
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  order_id uuid REFERENCES purchase_orders(id),
  location_id uuid NOT NULL REFERENCES locations(id),
  currency currency_code NOT NULL,
  rate_scaled_snapshot bigint,
  supplier_doc_ref text,
  business_date date NOT NULL DEFAULT CURRENT_DATE,
  total_minor bigint NOT NULL DEFAULT 0,
  posted_at timestamptz, posted_by uuid REFERENCES users(id),
  reversed_at timestamptz, reversed_by_id uuid, reversal_reason text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX goods_receipts_number ON goods_receipts (tenant_id, number) WHERE number IS NOT NULL;
CREATE TRIGGER goods_receipts_protect BEFORE UPDATE OR DELETE ON goods_receipts FOR EACH ROW EXECUTE FUNCTION protect_posted_document();

CREATE TABLE goods_receipt_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  receipt_id uuid NOT NULL REFERENCES goods_receipts(id) ON DELETE CASCADE,
  line_no integer NOT NULL,
  order_line_id uuid REFERENCES purchase_order_lines(id),
  item_id uuid NOT NULL REFERENCES items(id),
  unit_id uuid NOT NULL REFERENCES item_units(id),
  factor_snapshot bigint NOT NULL,
  qty_in_unit bigint NOT NULL CHECK (qty_in_unit > 0),
  bonus_qty_in_unit bigint NOT NULL DEFAULT 0 CHECK (bonus_qty_in_unit >= 0),
  ssu_qty_total bigint NOT NULL,                     -- (qty + bonus) × factor
  unit_cost_minor bigint NOT NULL CHECK (unit_cost_minor >= 0),   -- in receipt currency per purchase unit
  line_discount_minor bigint NOT NULL DEFAULT 0,
  landed_cost_minor bigint NOT NULL DEFAULT 0,
  lot_number text NOT NULL,
  expiry_date date,
  printed_public_price_minor bigint,
  source_type lot_source_type NOT NULL DEFAULT 'OFFICIAL',
  lot_id uuid REFERENCES lots(id),                   -- set at POST
  short_dated_override_by uuid REFERENCES users(id),
  UNIQUE (receipt_id, line_no)
);

CREATE TABLE supplier_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  number text,
  status document_status NOT NULL DEFAULT 'DRAFT',
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  supplier_invoice_no text,
  currency currency_code NOT NULL,
  rate_scaled_snapshot bigint,
  invoice_date date NOT NULL,
  due_date date,
  subtotal_minor bigint NOT NULL DEFAULT 0,
  discount_minor bigint NOT NULL DEFAULT 0,
  landed_cost_minor bigint NOT NULL DEFAULT 0,
  tax_minor bigint NOT NULL DEFAULT 0,
  total_minor bigint NOT NULL DEFAULT 0,
  paid_minor bigint NOT NULL DEFAULT 0,
  early_payment_days integer, early_payment_bp integer,
  posted_at timestamptz, posted_by uuid REFERENCES users(id),
  reversed_at timestamptz, reversed_by_id uuid, reversal_reason text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX supplier_invoices_number ON supplier_invoices (tenant_id, number) WHERE number IS NOT NULL;
CREATE TRIGGER supplier_invoices_protect BEFORE UPDATE OR DELETE ON supplier_invoices FOR EACH ROW EXECUTE FUNCTION protect_posted_document();

CREATE TABLE supplier_invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  invoice_id uuid NOT NULL REFERENCES supplier_invoices(id) ON DELETE CASCADE,
  receipt_line_id uuid REFERENCES goods_receipt_lines(id),
  kind text NOT NULL DEFAULT 'ITEM' CHECK (kind IN ('ITEM','FREIGHT','CUSTOMS','OTHER')),
  description text,
  qty_in_unit bigint, unit_price_minor bigint,
  amount_minor bigint NOT NULL
);

CREATE TABLE purchase_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  number text,
  status document_status NOT NULL DEFAULT 'DRAFT',
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  location_id uuid NOT NULL REFERENCES locations(id),
  currency currency_code NOT NULL,
  business_date date NOT NULL DEFAULT CURRENT_DATE,
  total_minor bigint NOT NULL DEFAULT 0,
  reason text,
  posted_at timestamptz, posted_by uuid REFERENCES users(id),
  reversed_at timestamptz, reversed_by_id uuid, reversal_reason text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1
);
CREATE TRIGGER purchase_returns_protect BEFORE UPDATE OR DELETE ON purchase_returns FOR EACH ROW EXECUTE FUNCTION protect_posted_document();

CREATE TABLE purchase_return_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  return_id uuid NOT NULL REFERENCES purchase_returns(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES items(id),
  lot_id uuid NOT NULL REFERENCES lots(id),
  unit_id uuid NOT NULL REFERENCES item_units(id),
  factor_snapshot bigint NOT NULL, qty_in_unit bigint NOT NULL CHECK (qty_in_unit > 0), ssu_qty bigint NOT NULL,
  unit_cost_minor_snapshot bigint NOT NULL,
  amount_minor bigint NOT NULL
);

CREATE TABLE party_payments (                        -- customer receipts & supplier payments
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  number text,
  status document_status NOT NULL DEFAULT 'DRAFT',
  party_type text NOT NULL CHECK (party_type IN ('CUSTOMER','SUPPLIER')),
  customer_id uuid REFERENCES customers(id), supplier_id uuid REFERENCES suppliers(id),
  cashbox_id uuid NOT NULL REFERENCES cashboxes(id),
  shift_id uuid REFERENCES shifts(id),
  method payment_method NOT NULL,
  currency currency_code NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  rate_scaled_snapshot bigint,
  allocations jsonb NOT NULL DEFAULT '[]'::jsonb,    -- [{documentType, documentId, amountMinor}]
  business_date date NOT NULL DEFAULT CURRENT_DATE,
  reference text, notes text,
  posted_at timestamptz, posted_by uuid REFERENCES users(id),
  reversed_at timestamptz, reversed_by_id uuid, reversal_reason text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1,
  CHECK ((party_type = 'CUSTOMER' AND customer_id IS NOT NULL) OR (party_type = 'SUPPLIER' AND supplier_id IS NOT NULL))
);
CREATE TRIGGER party_payments_protect BEFORE UPDATE OR DELETE ON party_payments FOR EACH ROW EXECUTE FUNCTION protect_posted_document();

-- ============================================================================ expenses
CREATE TABLE expense_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  parent_id uuid REFERENCES expense_categories(id),
  code text NOT NULL, name_ar text NOT NULL, name_en text NOT NULL,
  account_code text NOT NULL,                        -- GL mapping
  is_active boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, code)
);

CREATE TABLE expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  number text,
  status document_status NOT NULL DEFAULT 'DRAFT',
  category_id uuid NOT NULL REFERENCES expense_categories(id),
  cashbox_id uuid NOT NULL REFERENCES cashboxes(id),
  shift_id uuid REFERENCES shifts(id),
  currency currency_code NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  rate_scaled_snapshot bigint,
  business_date date NOT NULL DEFAULT CURRENT_DATE,
  description text, attachment_ref text,
  approved_by uuid REFERENCES users(id),
  posted_at timestamptz, posted_by uuid REFERENCES users(id),
  reversed_at timestamptz, reversed_by_id uuid, reversal_reason text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1
);
CREATE TRIGGER expenses_protect BEFORE UPDATE OR DELETE ON expenses FOR EACH ROW EXECUTE FUNCTION protect_posted_document();

-- ============================================================================ stocktake
CREATE TABLE stocktake_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  number text,
  status document_status NOT NULL DEFAULT 'DRAFT',
  location_id uuid NOT NULL REFERENCES locations(id),
  kind text NOT NULL DEFAULT 'FULL' CHECK (kind IN ('FULL','CYCLE','SPOT')),
  is_blind boolean NOT NULL DEFAULT true,
  freeze_movements boolean NOT NULL DEFAULT false,
  started_at timestamptz NOT NULL DEFAULT now(),
  snapshot_at timestamptz,
  business_date date NOT NULL DEFAULT CURRENT_DATE,
  approved_by uuid REFERENCES users(id),
  posted_at timestamptz, posted_by uuid REFERENCES users(id),
  reversed_at timestamptz, reversed_by_id uuid, reversal_reason text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1
);
CREATE TRIGGER stocktake_sessions_protect BEFORE UPDATE OR DELETE ON stocktake_sessions FOR EACH ROW EXECUTE FUNCTION protect_posted_document();

CREATE TABLE stocktake_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  session_id uuid NOT NULL REFERENCES stocktake_sessions(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES items(id),
  lot_id uuid NOT NULL REFERENCES lots(id),
  system_qty_ssu bigint NOT NULL,
  counted_qty_ssu bigint,
  variance_ssu bigint GENERATED ALWAYS AS (COALESCE(counted_qty_ssu, 0) - system_qty_ssu) STORED,
  reason text,
  counted_by uuid REFERENCES users(id), counted_at timestamptz,
  UNIQUE (session_id, lot_id)
);

-- ============================================================================ accounting (internal engine, D-022)
CREATE TABLE accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  code text NOT NULL,
  name_ar text NOT NULL, name_en text NOT NULL,
  parent_code text,
  normal_balance account_side NOT NULL,
  account_type text NOT NULL CHECK (account_type IN ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE')),
  is_postable boolean NOT NULL DEFAULT true,
  is_system boolean NOT NULL DEFAULT false,
  dimension_hint text,                               -- 'cashbox','customer','supplier','item'
  is_active boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, code)
);

CREATE TABLE journal_entries (                       -- APPEND-ONLY
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  entry_no bigint,
  document_type text NOT NULL,
  document_id uuid NOT NULL,
  business_date date NOT NULL,
  posted_at timestamptz NOT NULL DEFAULT now(),
  base_currency currency_code NOT NULL,
  memo text,
  reverses_entry_id uuid REFERENCES journal_entries(id),
  created_by uuid REFERENCES users(id),
  UNIQUE (tenant_id, document_type, document_id, reverses_entry_id)
);
CREATE INDEX journal_entries_date ON journal_entries (tenant_id, business_date);
CREATE TRIGGER journal_entries_immutable BEFORE UPDATE OR DELETE ON journal_entries FOR EACH ROW EXECUTE FUNCTION deny_mutation();

CREATE TABLE journal_lines (                         -- APPEND-ONLY
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  entry_id uuid NOT NULL REFERENCES journal_entries(id),
  line_no integer NOT NULL,
  account_code text NOT NULL,
  debit_minor bigint NOT NULL DEFAULT 0 CHECK (debit_minor >= 0),
  credit_minor bigint NOT NULL DEFAULT 0 CHECK (credit_minor >= 0),
  original_currency currency_code,
  original_amount_minor bigint,
  rate_scaled_snapshot bigint,
  memo text,
  dim_cashbox_id uuid, dim_customer_id uuid, dim_supplier_id uuid, dim_item_id uuid, dim_lot_id uuid,
  CHECK ((debit_minor > 0 AND credit_minor = 0) OR (credit_minor > 0 AND debit_minor = 0)),
  UNIQUE (entry_id, line_no)
);
CREATE INDEX journal_lines_account ON journal_lines (tenant_id, account_code);
CREATE TRIGGER journal_lines_immutable BEFORE UPDATE OR DELETE ON journal_lines FOR EACH ROW EXECUTE FUNCTION deny_mutation();

-- Balanced entry — checked at COMMIT (deferred) so lines can be inserted one by one
CREATE OR REPLACE FUNCTION check_entry_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d bigint; c bigint; n integer;
BEGIN
  SELECT COALESCE(SUM(debit_minor),0), COALESCE(SUM(credit_minor),0), COUNT(*) INTO d, c, n
    FROM journal_lines WHERE entry_id = NEW.entry_id;
  IF d <> c THEN
    RAISE EXCEPTION 'journal_unbalanced: entry % debit % credit % (diff %)', NEW.entry_id, d, c, d - c USING ERRCODE = 'P0009';
  END IF;
  IF n < 2 THEN
    RAISE EXCEPTION 'journal_too_few_lines: entry % has % line(s)', NEW.entry_id, n USING ERRCODE = 'P0009';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER journal_lines_balanced AFTER INSERT ON journal_lines
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_entry_balanced();

-- Postable accounts only
CREATE OR REPLACE FUNCTION check_account_postable() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p boolean;
BEGIN
  SELECT is_postable AND is_active INTO p FROM accounts WHERE tenant_id = NEW.tenant_id AND code = NEW.account_code;
  IF p IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'account_not_postable: % (tenant %)', NEW.account_code, NEW.tenant_id USING ERRCODE = 'P0010';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER journal_lines_account_check BEFORE INSERT ON journal_lines FOR EACH ROW EXECUTE FUNCTION check_account_postable();

-- ============================================================================ audit & outbox (APPEND-ONLY)
CREATE TABLE audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  actor_user_id uuid,
  approved_by uuid,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  before_data jsonb, after_data jsonb,
  reason text,
  device_id text, ip text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_entity ON audit_log (tenant_id, entity_type, entity_id, occurred_at DESC);
CREATE INDEX audit_log_actor ON audit_log (tenant_id, actor_user_id, occurred_at DESC);
CREATE TRIGGER audit_log_immutable BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION deny_mutation();

CREATE TABLE outbox (                                -- transactional outbox (ADR: events for sync/reporting)
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  aggregate_type text NOT NULL, aggregate_id uuid NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  attempts integer NOT NULL DEFAULT 0
);
CREATE INDEX outbox_unpublished ON outbox (occurred_at) WHERE published_at IS NULL;
-- outbox allows UPDATE of published_at/attempts only
CREATE OR REPLACE FUNCTION protect_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'append_only_violation: outbox' USING ERRCODE = 'P0001'; END IF;
  IF (to_jsonb(NEW) - 'published_at' - 'attempts') <> (to_jsonb(OLD) - 'published_at' - 'attempts') THEN
    RAISE EXCEPTION 'append_only_violation: outbox payload is immutable' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER outbox_protect BEFORE UPDATE OR DELETE ON outbox FOR EACH ROW EXECUTE FUNCTION protect_outbox();

-- ============================================================================ updated_at triggers
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tenants','users','roles','item_categories','items','item_units','price_lists','customers','suppliers','locations','lots','cashboxes','shifts',
                           'sales_invoices','sales_returns','purchase_orders','goods_receipts','supplier_invoices','purchase_returns','party_payments','expenses','stocktake_sessions'] LOOP
    EXECUTE format('CREATE TRIGGER %I_touch BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t, t);
  END LOOP;
END $$;

-- ============================================================================ Row-Level Security (tenant isolation)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['users','roles','exchange_rates','item_categories','items','item_units','item_barcodes','price_lists','price_list_items','price_history','official_prices',
                           'customers','suppliers','locations','lots','stock_movements','cashboxes','shifts','cash_movements','numbering_series',
                           'sales_invoices','sales_invoice_lines','sale_line_lots','invoice_payments','sales_returns','sales_return_lines',
                           'purchase_orders','purchase_order_lines','goods_receipts','goods_receipt_lines','supplier_invoices','supplier_invoice_lines','purchase_returns','purchase_return_lines',
                           'party_payments','expense_categories','expenses','stocktake_sessions','stocktake_lines','accounts','journal_entries','journal_lines','audit_log','outbox'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())', t);
  END LOOP;
END $$;

-- Application role (least privilege; owner role bypasses RLS for migrations only)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pharmacore_app') THEN CREATE ROLE pharmacore_app NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO pharmacore_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO pharmacore_app;
GRANT SELECT ON stock_balances TO pharmacore_app;
-- No DELETE anywhere for the app role; ledgers additionally block UPDATE via triggers.
REVOKE UPDATE ON stock_movements, journal_entries, journal_lines, audit_log, cash_movements, price_history FROM pharmacore_app;
GRANT EXECUTE ON FUNCTION next_document_number(uuid, text, text) TO pharmacore_app;

COMMIT;
