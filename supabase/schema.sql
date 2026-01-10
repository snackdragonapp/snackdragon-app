


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."add_entry_from_catalog"("p_day_id" "uuid", "p_catalog_item_id" "uuid", "p_mult" numeric, "p_status" "text", "p_client_op_id" "uuid" DEFAULT NULL::"uuid", "p_id" "uuid" DEFAULT NULL::"uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_user   uuid := auth.uid();
  v_owner  uuid;
  v_dog_id uuid;

  v_name   text;
  v_unit   text;
  v_kpu    numeric;
  v_defqty numeric;

  v_qty    numeric;
  v_kcal   numeric;
  v_id     uuid;
begin
  if v_user is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  if p_status not in ('planned', 'eaten') then
    raise exception 'invalid status' using errcode = '22023';
  end if;

  if p_mult is null or p_mult <= 0 then
    raise exception 'invalid multiplier' using errcode = '22023';
  end if;

  -- Validate day belongs to caller; also capture the day's dog_id
  select dg.user_id, d.dog_id
    into v_owner, v_dog_id
  from public.days d
  join public.dogs dg on dg.id = d.dog_id
  where d.id = p_day_id;

  if v_owner is null or v_owner <> v_user then
    raise exception 'forbidden: day not owned by caller' using errcode = '42501';
  end if;

  -- Validate catalog item belongs to the SAME dog as the day (and caller)
  select ci.name, ci.unit, ci.kcal_per_unit, ci.default_qty
    into v_name, v_unit, v_kpu, v_defqty
  from public.catalog_items ci
  join public.dogs dg on dg.id = ci.dog_id
  where ci.id = p_catalog_item_id
    and ci.dog_id = v_dog_id
    and dg.user_id = v_user;

  if v_name is null then
    raise exception 'forbidden: catalog item not owned by caller or wrong dog'
      using errcode = '42501';
  end if;

  v_qty := v_defqty * p_mult;
  if v_qty is null or v_qty <= 0 then
    raise exception 'invalid qty' using errcode = '22023';
  end if;

  -- Match existing app behavior: round kcal to 2 decimals
  v_kcal := round((v_qty * v_kpu)::numeric, 2);

  v_id := public.add_entry_with_order(
    p_day_id,
    v_name,
    v_qty,
    v_unit,
    v_kcal,
    p_status,
    p_catalog_item_id,
    p_client_op_id,
    p_id
  );

  return v_id;
end;
$$;


ALTER FUNCTION "public"."add_entry_from_catalog"("p_day_id" "uuid", "p_catalog_item_id" "uuid", "p_mult" numeric, "p_status" "text", "p_client_op_id" "uuid", "p_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."add_entry_with_order"("p_day_id" "uuid", "p_name" "text", "p_qty" numeric, "p_unit" "text", "p_kcal" numeric, "p_status" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  return public.add_entry_with_order(
    p_day_id,
    p_name,
    p_qty,
    p_unit,
    p_kcal,
    p_status,
    NULL::uuid,   -- p_catalog_item_id
    NULL::uuid,   -- p_client_op_id
    NULL::uuid    -- p_id (use default gen_random_uuid())
  );
end;
$$;


ALTER FUNCTION "public"."add_entry_with_order"("p_day_id" "uuid", "p_name" "text", "p_qty" numeric, "p_unit" "text", "p_kcal" numeric, "p_status" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."add_entry_with_order"("p_day_id" "uuid", "p_name" "text", "p_qty" numeric, "p_unit" "text", "p_kcal" numeric, "p_status" "text", "p_catalog_item_id" "uuid" DEFAULT NULL::"uuid", "p_client_op_id" "uuid" DEFAULT NULL::"uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_user  uuid := auth.uid();
  v_owner uuid;
  v_next  integer;
  v_id    uuid;
  i       int;
begin
  if v_user is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  select dg.user_id into v_owner
  from public.days d
  join public.dogs dg on dg.id = d.dog_id
  where d.id = p_day_id;

  if v_owner is null or v_owner <> v_user then
    raise exception 'forbidden: day not owned by caller'
      using errcode = '42501';
  end if;

  if p_qty is null or p_qty <= 0 then
    raise exception 'invalid qty' using errcode = '22023';
  end if;

  -- Retry to avoid UNIQUE(day_id, ordering) races
  for i in 1..3 loop
    select coalesce(max(e.ordering), -1) + 1
      into v_next
    from public.entries e
    where e.day_id = p_day_id;

    begin
      insert into public.entries (
        day_id,
        name,
        qty,
        unit,
        kcal_snapshot,
        status,
        ordering,
        kcal_per_unit_snapshot,
        catalog_item_id,
        client_op_id
      ) values (
        p_day_id,
        p_name,
        p_qty,
        p_unit,
        p_kcal,
        p_status,
        v_next,
        round((p_kcal / p_qty)::numeric, 4),
        p_catalog_item_id,
        p_client_op_id
      )
      returning id into v_id;

      return v_id; -- success
    exception
      when unique_violation then
        continue; -- someone else grabbed v_next; recompute and retry
    end;
  end loop;

  raise exception 'could not allocate ordering after retries'
    using errcode = '40001';
end;
$$;


ALTER FUNCTION "public"."add_entry_with_order"("p_day_id" "uuid", "p_name" "text", "p_qty" numeric, "p_unit" "text", "p_kcal" numeric, "p_status" "text", "p_catalog_item_id" "uuid", "p_client_op_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."add_entry_with_order"("p_day_id" "uuid", "p_name" "text", "p_qty" numeric, "p_unit" "text", "p_kcal" numeric, "p_status" "text", "p_catalog_item_id" "uuid" DEFAULT NULL::"uuid", "p_client_op_id" "uuid" DEFAULT NULL::"uuid", "p_id" "uuid" DEFAULT NULL::"uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_user  uuid := auth.uid();
  v_owner uuid;
  v_next  integer;
  v_id    uuid;
  i       int;
begin
  if v_user is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  select dg.user_id into v_owner
  from public.days d
  join public.dogs dg on dg.id = d.dog_id
  where d.id = p_day_id;

  if v_owner is null or v_owner <> v_user then
    raise exception 'forbidden: day not owned by caller'
      using errcode = '42501';
  end if;

  if p_qty is null or p_qty <= 0 then
    raise exception 'invalid qty' using errcode = '22023';
  end if;

  -- Retry to avoid UNIQUE(day_id, ordering) races
  for i in 1..3 loop
    select coalesce(max(e.ordering), -1) + 1
      into v_next
    from public.entries e
    where e.day_id = p_day_id;

    begin
      insert into public.entries (
        id,
        day_id,
        name,
        qty,
        unit,
        kcal_snapshot,
        status,
        ordering,
        kcal_per_unit_snapshot,
        catalog_item_id,
        client_op_id
      ) values (
        coalesce(p_id, gen_random_uuid()),
        p_day_id,
        p_name,
        p_qty,
        p_unit,
        p_kcal,
        p_status,
        v_next,
        round((p_kcal / p_qty)::numeric, 4),
        p_catalog_item_id,
        p_client_op_id
      )
      returning id into v_id;

      return v_id; -- success
    exception
      when unique_violation then
        continue; -- someone else grabbed v_next; recompute and retry
    end;
  end loop;

  raise exception 'could not allocate ordering after retries'
    using errcode = '40001';
end;
$$;


ALTER FUNCTION "public"."add_entry_with_order"("p_day_id" "uuid", "p_name" "text", "p_qty" numeric, "p_unit" "text", "p_kcal" numeric, "p_status" "text", "p_catalog_item_id" "uuid", "p_client_op_id" "uuid", "p_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_entry_with_op"("p_entry_id" "uuid", "p_client_op_id" "uuid" DEFAULT NULL::"uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_user uuid := auth.uid();
  v_day  uuid;
begin
  if v_user is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  -- Lock the entry and verify ownership via the parent day
  select e.day_id
    into v_day
  from public.entries e
  join public.days d on d.id = e.day_id
  join public.dogs dg on dg.id = d.dog_id
  where e.id = p_entry_id and dg.user_id = v_user
  for update;

  if v_day is null then
    raise exception 'forbidden: entry not owned by caller'
      using errcode = '42501';
  end if;

  -- Stamp client_op_id, then delete so DELETE has old.client_op_id
  update public.entries
  set client_op_id = p_client_op_id
  where id = p_entry_id;

  delete from public.entries
  where id = p_entry_id;

  return;
end;
$$;


ALTER FUNCTION "public"."delete_entry_with_op"("p_entry_id" "uuid", "p_client_op_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_catalog_items_usage_order"("p_dog_id" "uuid") RETURNS TABLE("id" "uuid", "name" "text", "unit" "text", "kcal_per_unit" numeric, "default_qty" numeric, "created_at" timestamp with time zone, "last_used_date" "date", "first_order_on_last_day" integer)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
WITH last_use AS (
  SELECT
    e.catalog_item_id,
    max(d.date) AS last_used_date
  FROM public.entries e
  JOIN public.days d on d.id = e.day_id
  JOIN public.dogs dg on dg.id = d.dog_id
  WHERE e.catalog_item_id IS NOT NULL
    AND dg.id = p_dog_id
    AND dg.user_id = auth.uid()
  GROUP BY e.catalog_item_id
), first_order AS (
  SELECT
    e.catalog_item_id,
    min(e.ordering) AS first_order_on_last_day
  FROM public.entries e
  JOIN public.days d on d.id = e.day_id
  JOIN public.dogs dg on dg.id = d.dog_id
  JOIN last_use lu on lu.catalog_item_id = e.catalog_item_id AND lu.last_used_date = d.date
  WHERE e.catalog_item_id IS NOT NULL
    AND dg.id = p_dog_id
    AND dg.user_id = auth.uid()
  GROUP BY e.catalog_item_id
)
SELECT
  ci.id,
  ci.name,
  ci.unit,
  ci.kcal_per_unit,
  ci.default_qty,
  ci.created_at,
  lu.last_used_date,
  fo.first_order_on_last_day
FROM public.catalog_items ci
JOIN public.dogs dg on dg.id = ci.dog_id
LEFT JOIN last_use lu on lu.catalog_item_id = ci.id
LEFT JOIN first_order fo on fo.catalog_item_id = ci.id
WHERE dg.id = p_dog_id
  AND dg.user_id = auth.uid()
ORDER BY
  lu.last_used_date DESC NULLS LAST,
  fo.first_order_on_last_day ASC NULLS LAST,
  ci.name ASC;
$$;


ALTER FUNCTION "public"."get_catalog_items_usage_order"("p_dog_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_daily_kcal_totals"("p_dog_id" "uuid") RETURNS TABLE("date" "date", "planned_kcal" numeric, "eaten_kcal" numeric, "total_kcal" numeric)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
with sums as (
  select
    d.date,
    sum(case when e.status = 'planned' then e.kcal_snapshot else 0 end) as planned_kcal,
    sum(case when e.status = 'eaten' then e.kcal_snapshot else 0 end) as eaten_kcal,
    sum(e.kcal_snapshot) as total_kcal
  from public.days d
  join public.dogs dg on dg.id = d.dog_id
  left join public.entries e on e.day_id = d.id
  where dg.id = p_dog_id
    and dg.user_id = auth.uid()
  group by d.date
)
select
  date,
  coalesce(planned_kcal, 0) as planned_kcal,
  coalesce(eaten_kcal, 0) as eaten_kcal,
  coalesce(total_kcal, 0) as total_kcal
from sums
order by date asc;
$$;


ALTER FUNCTION "public"."get_daily_kcal_totals"("p_dog_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_or_create_day"("p_dog_id" "uuid", "p_date" "date") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_user uuid := auth.uid();
  v_day uuid;
begin
  if v_user is null then raise exception 'unauthenticated' using errcode = '28000'; end if;

  -- Validate the dog belongs to the caller
  if not exists (
    select 1
    from public.dogs d
    where d.id = p_dog_id and d.user_id = v_user
  ) then
    raise exception 'forbidden: dog not owned by caller' using errcode = '42501';
  end if;

  insert into public.days (user_id, dog_id, date)
  values (v_user, p_dog_id, p_date)
  on conflict (dog_id, date)
  do update set date = excluded.date
  returning id into v_day;

  return v_day;
end;
$$;


ALTER FUNCTION "public"."get_or_create_day"("p_dog_id" "uuid", "p_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."move_entry"("p_entry_id" "uuid", "p_dir" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_user uuid := auth.uid();
  v_day uuid;
  v_pos integer;
  v_neighbor uuid;
  v_neighbor_pos integer;
  v_tmp integer;
begin
  if v_user is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  -- Lock the target entry row and verify ownership via parent day
  select e.day_id, e.ordering
    into v_day, v_pos
  from public.entries e
  join public.days d on d.id = e.day_id
  join public.dogs dg on dg.id = d.dog_id
  where e.id = p_entry_id
    and dg.user_id = v_user
  for update;

  if v_day is null then
    raise exception 'forbidden: entry not owned by caller' using errcode = '42501';
  end if;

  -- Lock the neighbor we will swap with
  if p_dir = 'up' then
    select e.id, e.ordering into v_neighbor, v_neighbor_pos
    from public.entries e
    where e.day_id = v_day and e.ordering < v_pos
    order by e.ordering desc
    limit 1
    for update;
  elsif p_dir = 'down' then
    select e.id, e.ordering into v_neighbor, v_neighbor_pos
    from public.entries e
    where e.day_id = v_day and e.ordering > v_pos
    order by e.ordering asc
    limit 1
    for update;
  else
    raise exception 'invalid direction: %', p_dir using errcode = '22023';
  end if;

  -- No neighbor (already at top/bottom)
  if v_neighbor is null then
    return;
  end if;

  -- Use a guaranteed-unique temporary slot derived from current position.
  -- Our ordering domain is >= 0 in normal use; negatives are reserved for temp swaps.
  v_tmp := -(v_pos + 1);

  -- Three-step swap to satisfy UNIQUE(day_id, ordering)
  -- 1) move neighbor to tmp
  update public.entries
  set ordering = v_tmp
  where id = v_neighbor;

  -- 2) move current into neighbor's slot
  update public.entries
  set ordering = v_neighbor_pos
  where id = p_entry_id;

  -- 3) move neighbor into current's old slot
  update public.entries
  set ordering = v_pos
  where id = v_neighbor;

  return;
end;
$$;


ALTER FUNCTION "public"."move_entry"("p_entry_id" "uuid", "p_dir" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reorder_entries"("p_day_id" "uuid", "p_ids" "uuid"[]) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_user uuid := auth.uid();
  v_expected int;
  v_seen int;
  v_id uuid;
  v_idx int := 0;
begin
  if v_user is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  -- Ensure the day belongs to the caller.
  if not exists (
    select 1
    from public.days d
    join public.dogs dg on dg.id = d.dog_id
    where d.id = p_day_id and dg.user_id = v_user
  ) then
    raise exception 'forbidden: day not owned by caller' using errcode = '42501';
  end if;

  -- Lock all rows for that day.
  perform 1 from public.entries e
  where e.day_id = p_day_id
  for update;

  -- Sanity: require the array to include all entry ids for the day.
  select count(*) into v_expected from public.entries where day_id = p_day_id;
  select coalesce(array_length(p_ids, 1), 0) into v_seen;

  if v_seen <> v_expected then
    raise exception 'mismatch: provided % ids but day has %', v_seen, v_expected using errcode = '22023';
  end if;

  -- Temporary negative to avoid UNIQUE(day_id, ordering) collisions during rewrite.
  update public.entries
  set ordering = -ordering - 1
  where day_id = p_day_id;

  -- Assign 0..N-1 in the given order.
  v_idx := 0;
  foreach v_id in array p_ids loop
    update public.entries
    set ordering = v_idx
    where id = v_id and day_id = p_day_id;
    v_idx := v_idx + 1;
  end loop;

  return;
end;
$$;


ALTER FUNCTION "public"."reorder_entries"("p_day_id" "uuid", "p_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reorder_entries"("p_day_id" "uuid", "p_ids" "uuid"[], "p_client_op_id" "uuid" DEFAULT NULL::"uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_user     uuid := auth.uid();
  v_expected int;
  v_seen     int;
  v_id       uuid;
  v_idx      int := 0;
begin
  if v_user is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  -- Ensure the day belongs to the caller.
  if not exists (
    select 1
    from public.days d
    join public.dogs dg on dg.id = d.dog_id
    where d.id = p_day_id and dg.user_id = v_user
  ) then
    raise exception 'forbidden: day not owned by caller'
      using errcode = '42501';
  end if;

  -- Lock all rows for that day.
  perform 1 from public.entries e
  where e.day_id = p_day_id
  for update;

  -- Sanity: require the array to include all entry ids for the day.
  select count(*) into v_expected
  from public.entries
  where day_id = p_day_id;

  select coalesce(array_length(p_ids, 1), 0) into v_seen;

  if v_seen <> v_expected then
    raise exception 'mismatch: provided % ids but day has %',
      v_seen, v_expected using errcode = '22023';
  end if;

  -- Temporary negative to avoid UNIQUE(day_id, ordering) collisions during rewrite.
  update public.entries
  set ordering = -ordering - 1
  where day_id = p_day_id;

  -- Assign 0..N-1 in the given order, and stamp client_op_id on each touched row.
  v_idx := 0;
  foreach v_id in array p_ids loop
    update public.entries
    set ordering     = v_idx,
        client_op_id = p_client_op_id
    where id = v_id and day_id = p_day_id;
    v_idx := v_idx + 1;
  end loop;

  return;
end;
$$;


ALTER FUNCTION "public"."reorder_entries"("p_day_id" "uuid", "p_ids" "uuid"[], "p_client_op_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_entry_qty_and_status"("p_entry_id" "uuid", "p_qty" numeric, "p_next_status" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_user uuid := auth.uid();
  v_day uuid;
  v_per_unit numeric(12,4);
  v_old_qty numeric;
  v_old_kcal numeric;
begin
  if v_user is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  if p_next_status not in ('planned','eaten') then
    raise exception 'invalid status' using errcode = '22023';
  end if;

  if p_qty is null or p_qty <= 0 then
    raise exception 'invalid qty' using errcode = '22023';
  end if;

  -- Lock the entry and verify ownership via the parent day
  select e.day_id, e.kcal_per_unit_snapshot, e.qty, e.kcal_snapshot
    into v_day, v_per_unit, v_old_qty, v_old_kcal
  from public.entries e
  join public.days d on d.id = e.day_id
  join public.dogs dg on dg.id = d.dog_id
  where e.id = p_entry_id and dg.user_id = v_user
  for update;

  if v_day is null then
    raise exception 'forbidden: entry not owned by caller' using errcode = '42501';
  end if;

  -- Fallback for very old rows that may lack a snapshot
  v_per_unit := coalesce(v_per_unit,
                         round((v_old_kcal / nullif(v_old_qty, 0))::numeric, 4));

  if v_per_unit is null then
    raise exception 'cannot compute per-unit snapshot' using errcode = '22023';
  end if;

  update public.entries
  set qty = p_qty,
      kcal_per_unit_snapshot = v_per_unit,
      kcal_snapshot = round((v_per_unit * p_qty)::numeric, 2),
      status = p_next_status
  where id = p_entry_id;

  return;
end;
$$;


ALTER FUNCTION "public"."update_entry_qty_and_status"("p_entry_id" "uuid", "p_qty" numeric, "p_next_status" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_entry_qty_and_status"("p_entry_id" "uuid", "p_qty" numeric, "p_next_status" "text", "p_client_op_id" "uuid" DEFAULT NULL::"uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_user      uuid := auth.uid();
  v_day       uuid;
  v_per_unit  numeric(12,4);
  v_old_qty   numeric;
  v_old_kcal  numeric;
begin
  if v_user is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  if p_next_status not in ('planned','eaten') then
    raise exception 'invalid status' using errcode = '22023';
  end if;

  if p_qty is null or p_qty <= 0 then
    raise exception 'invalid qty' using errcode = '22023';
  end if;

  -- Lock the entry and verify ownership via the parent day
  select e.day_id,
         e.kcal_per_unit_snapshot,
         e.qty,
         e.kcal_snapshot
    into v_day, v_per_unit, v_old_qty, v_old_kcal
  from public.entries e
  join public.days d on d.id = e.day_id
  join public.dogs dg on dg.id = d.dog_id
  where e.id = p_entry_id and dg.user_id = v_user
  for update;

  if v_day is null then
    raise exception 'forbidden: entry not owned by caller'
      using errcode = '42501';
  end if;

  -- Fallback for very old rows that may lack a snapshot
  v_per_unit := coalesce(
    v_per_unit,
    round((v_old_kcal / nullif(v_old_qty, 0))::numeric, 4)
  );

  if v_per_unit is null then
    raise exception 'cannot compute per-unit snapshot'
      using errcode = '22023';
  end if;

  update public.entries
  set qty                    = p_qty,
      kcal_per_unit_snapshot = v_per_unit,
      kcal_snapshot          = round((v_per_unit * p_qty)::numeric, 2),
      status                 = p_next_status,
      client_op_id           = p_client_op_id
  where id = p_entry_id;

  return;
end;
$$;


ALTER FUNCTION "public"."update_entry_qty_and_status"("p_entry_id" "uuid", "p_qty" numeric, "p_next_status" "text", "p_client_op_id" "uuid") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."catalog_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "unit" "text" NOT NULL,
    "kcal_per_unit" numeric(10,4) NOT NULL,
    "default_qty" numeric(10,2) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "dog_id" "uuid" NOT NULL
);

ALTER TABLE ONLY "public"."catalog_items" REPLICA IDENTITY FULL;


ALTER TABLE "public"."catalog_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."days" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "date" "date" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "dog_id" "uuid" NOT NULL
);


ALTER TABLE "public"."days" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."dogs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "archived_at" timestamp with time zone,
    CONSTRAINT "dogs_name_nonempty" CHECK (("char_length"("btrim"("name")) > 0))
);


ALTER TABLE "public"."dogs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "day_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "qty" numeric(10,2) NOT NULL,
    "unit" "text" NOT NULL,
    "kcal_snapshot" numeric(10,2) NOT NULL,
    "status" "text" DEFAULT 'planned'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ordering" integer NOT NULL,
    "catalog_item_id" "uuid",
    "kcal_per_unit_snapshot" numeric(12,4) NOT NULL,
    "client_op_id" "uuid",
    CONSTRAINT "entries_status_check" CHECK (("status" = ANY (ARRAY['planned'::"text", 'eaten'::"text"])))
);

ALTER TABLE ONLY "public"."entries" REPLICA IDENTITY FULL;


ALTER TABLE "public"."entries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."goals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "start_date" "date" NOT NULL,
    "kcal_target" integer NOT NULL,
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "dog_id" "uuid" NOT NULL,
    CONSTRAINT "goals_kcal_check" CHECK ((("kcal_target" >= 200) AND ("kcal_target" <= 5000)))
);

ALTER TABLE ONLY "public"."goals" REPLICA IDENTITY FULL;


ALTER TABLE "public"."goals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."weights" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "measured_at" "date" NOT NULL,
    "method" "text" NOT NULL,
    "weight_kg" numeric(7,3) NOT NULL,
    "me_kg" numeric(7,3),
    "me_and_dog_kg" numeric(7,3),
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "dog_id" "uuid" NOT NULL,
    CONSTRAINT "weights_method_check" CHECK (("method" = ANY (ARRAY['vet'::"text", 'home_diff'::"text"])))
);

ALTER TABLE ONLY "public"."weights" REPLICA IDENTITY FULL;


ALTER TABLE "public"."weights" OWNER TO "postgres";


ALTER TABLE ONLY "public"."catalog_items"
    ADD CONSTRAINT "catalog_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."days"
    ADD CONSTRAINT "days_dog_id_date_key" UNIQUE ("dog_id", "date");



ALTER TABLE ONLY "public"."days"
    ADD CONSTRAINT "days_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."dogs"
    ADD CONSTRAINT "dogs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."entries"
    ADD CONSTRAINT "entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."goals"
    ADD CONSTRAINT "goals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."weights"
    ADD CONSTRAINT "weights_pkey" PRIMARY KEY ("id");



CREATE UNIQUE INDEX "catalog_items_dog_name_unit_key" ON "public"."catalog_items" USING "btree" ("dog_id", "lower"("btrim"("name")), "lower"("btrim"("unit")));



CREATE UNIQUE INDEX "dogs_user_name_key" ON "public"."dogs" USING "btree" ("user_id", "lower"("btrim"("name")));



CREATE INDEX "entries_catalog_item_id_idx" ON "public"."entries" USING "btree" ("catalog_item_id");



CREATE UNIQUE INDEX "entries_day_ordering_key" ON "public"."entries" USING "btree" ("day_id", "ordering");



CREATE INDEX "entries_dayid_order_idx" ON "public"."entries" USING "btree" ("day_id", "ordering");



CREATE UNIQUE INDEX "goals_dog_start_date_key" ON "public"."goals" USING "btree" ("dog_id", "start_date");



CREATE INDEX "goals_dog_start_idx" ON "public"."goals" USING "btree" ("dog_id", "start_date" DESC, "created_at" DESC);



CREATE INDEX "weights_dog_measured_at_idx" ON "public"."weights" USING "btree" ("dog_id", "measured_at" DESC, "created_at" DESC);



ALTER TABLE ONLY "public"."catalog_items"
    ADD CONSTRAINT "catalog_items_dog_id_fkey" FOREIGN KEY ("dog_id") REFERENCES "public"."dogs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."days"
    ADD CONSTRAINT "days_dog_id_fkey" FOREIGN KEY ("dog_id") REFERENCES "public"."dogs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."dogs"
    ADD CONSTRAINT "dogs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."entries"
    ADD CONSTRAINT "entries_catalog_item_id_fkey" FOREIGN KEY ("catalog_item_id") REFERENCES "public"."catalog_items"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."entries"
    ADD CONSTRAINT "entries_day_id_fkey" FOREIGN KEY ("day_id") REFERENCES "public"."days"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."goals"
    ADD CONSTRAINT "goals_dog_id_fkey" FOREIGN KEY ("dog_id") REFERENCES "public"."dogs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."weights"
    ADD CONSTRAINT "weights_dog_id_fkey" FOREIGN KEY ("dog_id") REFERENCES "public"."dogs"("id") ON DELETE CASCADE;



CREATE POLICY "catalog_delete_own" ON "public"."catalog_items" FOR DELETE TO "authenticated" USING ((("user_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."dogs" "dg"
  WHERE (("dg"."id" = "catalog_items"."dog_id") AND ("dg"."user_id" = "auth"."uid"()))))));



CREATE POLICY "catalog_insert_own" ON "public"."catalog_items" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."dogs" "dg"
  WHERE (("dg"."id" = "catalog_items"."dog_id") AND ("dg"."user_id" = "auth"."uid"()))))));



ALTER TABLE "public"."catalog_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "catalog_select_own" ON "public"."catalog_items" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."dogs" "dg"
  WHERE (("dg"."id" = "catalog_items"."dog_id") AND ("dg"."user_id" = "auth"."uid"()))))));



CREATE POLICY "catalog_update_own" ON "public"."catalog_items" FOR UPDATE TO "authenticated" USING ((("user_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."dogs" "dg"
  WHERE (("dg"."id" = "catalog_items"."dog_id") AND ("dg"."user_id" = "auth"."uid"())))))) WITH CHECK ((("user_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."dogs" "dg"
  WHERE (("dg"."id" = "catalog_items"."dog_id") AND ("dg"."user_id" = "auth"."uid"()))))));



ALTER TABLE "public"."days" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "days_delete_own" ON "public"."days" FOR DELETE TO "authenticated" USING ((("user_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."dogs" "dg"
  WHERE (("dg"."id" = "days"."dog_id") AND ("dg"."user_id" = "auth"."uid"()))))));



CREATE POLICY "days_insert_own" ON "public"."days" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."dogs" "dg"
  WHERE (("dg"."id" = "days"."dog_id") AND ("dg"."user_id" = "auth"."uid"()))))));



CREATE POLICY "days_select_own" ON "public"."days" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."dogs" "dg"
  WHERE (("dg"."id" = "days"."dog_id") AND ("dg"."user_id" = "auth"."uid"()))))));



CREATE POLICY "days_update_own" ON "public"."days" FOR UPDATE TO "authenticated" USING ((("user_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."dogs" "dg"
  WHERE (("dg"."id" = "days"."dog_id") AND ("dg"."user_id" = "auth"."uid"())))))) WITH CHECK ((("user_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."dogs" "dg"
  WHERE (("dg"."id" = "days"."dog_id") AND ("dg"."user_id" = "auth"."uid"()))))));



ALTER TABLE "public"."dogs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "dogs_delete_own" ON "public"."dogs" FOR DELETE TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "dogs_insert_own" ON "public"."dogs" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "dogs_select_own" ON "public"."dogs" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "dogs_update_own" ON "public"."dogs" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."entries" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "entries_delete_via_day" ON "public"."entries" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."days" "d"
  WHERE (("d"."id" = "entries"."day_id") AND ("d"."user_id" = "auth"."uid"())))));



CREATE POLICY "entries_insert_via_day" ON "public"."entries" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."days" "d"
  WHERE (("d"."id" = "entries"."day_id") AND ("d"."user_id" = "auth"."uid"())))));



CREATE POLICY "entries_select_via_day" ON "public"."entries" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."days" "d"
  WHERE (("d"."id" = "entries"."day_id") AND ("d"."user_id" = "auth"."uid"())))));



CREATE POLICY "entries_update_via_day" ON "public"."entries" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."days" "d"
  WHERE (("d"."id" = "entries"."day_id") AND ("d"."user_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."days" "d"
  WHERE (("d"."id" = "entries"."day_id") AND ("d"."user_id" = "auth"."uid"())))));



ALTER TABLE "public"."goals" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "goals_delete_own" ON "public"."goals" FOR DELETE TO "authenticated" USING ((("user_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."dogs" "dg"
  WHERE (("dg"."id" = "goals"."dog_id") AND ("dg"."user_id" = "auth"."uid"()))))));



CREATE POLICY "goals_insert_own" ON "public"."goals" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."dogs" "dg"
  WHERE (("dg"."id" = "goals"."dog_id") AND ("dg"."user_id" = "auth"."uid"()))))));



CREATE POLICY "goals_select_own" ON "public"."goals" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."dogs" "dg"
  WHERE (("dg"."id" = "goals"."dog_id") AND ("dg"."user_id" = "auth"."uid"()))))));



CREATE POLICY "goals_update_own" ON "public"."goals" FOR UPDATE TO "authenticated" USING ((("user_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."dogs" "dg"
  WHERE (("dg"."id" = "goals"."dog_id") AND ("dg"."user_id" = "auth"."uid"())))))) WITH CHECK ((("user_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."dogs" "dg"
  WHERE (("dg"."id" = "goals"."dog_id") AND ("dg"."user_id" = "auth"."uid"()))))));



ALTER TABLE "public"."weights" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "weights_delete_own" ON "public"."weights" FOR DELETE TO "authenticated" USING ((("user_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."dogs" "dg"
  WHERE (("dg"."id" = "weights"."dog_id") AND ("dg"."user_id" = "auth"."uid"()))))));



CREATE POLICY "weights_insert_own" ON "public"."weights" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."dogs" "dg"
  WHERE (("dg"."id" = "weights"."dog_id") AND ("dg"."user_id" = "auth"."uid"()))))));



CREATE POLICY "weights_select_own" ON "public"."weights" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."dogs" "dg"
  WHERE (("dg"."id" = "weights"."dog_id") AND ("dg"."user_id" = "auth"."uid"()))))));



CREATE POLICY "weights_update_own" ON "public"."weights" FOR UPDATE TO "authenticated" USING ((("user_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."dogs" "dg"
  WHERE (("dg"."id" = "weights"."dog_id") AND ("dg"."user_id" = "auth"."uid"())))))) WITH CHECK ((("user_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."dogs" "dg"
  WHERE (("dg"."id" = "weights"."dog_id") AND ("dg"."user_id" = "auth"."uid"()))))));



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."add_entry_from_catalog"("p_day_id" "uuid", "p_catalog_item_id" "uuid", "p_mult" numeric, "p_status" "text", "p_client_op_id" "uuid", "p_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."add_entry_from_catalog"("p_day_id" "uuid", "p_catalog_item_id" "uuid", "p_mult" numeric, "p_status" "text", "p_client_op_id" "uuid", "p_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."add_entry_from_catalog"("p_day_id" "uuid", "p_catalog_item_id" "uuid", "p_mult" numeric, "p_status" "text", "p_client_op_id" "uuid", "p_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."add_entry_with_order"("p_day_id" "uuid", "p_name" "text", "p_qty" numeric, "p_unit" "text", "p_kcal" numeric, "p_status" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."add_entry_with_order"("p_day_id" "uuid", "p_name" "text", "p_qty" numeric, "p_unit" "text", "p_kcal" numeric, "p_status" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."add_entry_with_order"("p_day_id" "uuid", "p_name" "text", "p_qty" numeric, "p_unit" "text", "p_kcal" numeric, "p_status" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."add_entry_with_order"("p_day_id" "uuid", "p_name" "text", "p_qty" numeric, "p_unit" "text", "p_kcal" numeric, "p_status" "text", "p_catalog_item_id" "uuid", "p_client_op_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."add_entry_with_order"("p_day_id" "uuid", "p_name" "text", "p_qty" numeric, "p_unit" "text", "p_kcal" numeric, "p_status" "text", "p_catalog_item_id" "uuid", "p_client_op_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."add_entry_with_order"("p_day_id" "uuid", "p_name" "text", "p_qty" numeric, "p_unit" "text", "p_kcal" numeric, "p_status" "text", "p_catalog_item_id" "uuid", "p_client_op_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."add_entry_with_order"("p_day_id" "uuid", "p_name" "text", "p_qty" numeric, "p_unit" "text", "p_kcal" numeric, "p_status" "text", "p_catalog_item_id" "uuid", "p_client_op_id" "uuid", "p_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."add_entry_with_order"("p_day_id" "uuid", "p_name" "text", "p_qty" numeric, "p_unit" "text", "p_kcal" numeric, "p_status" "text", "p_catalog_item_id" "uuid", "p_client_op_id" "uuid", "p_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."add_entry_with_order"("p_day_id" "uuid", "p_name" "text", "p_qty" numeric, "p_unit" "text", "p_kcal" numeric, "p_status" "text", "p_catalog_item_id" "uuid", "p_client_op_id" "uuid", "p_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."delete_entry_with_op"("p_entry_id" "uuid", "p_client_op_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."delete_entry_with_op"("p_entry_id" "uuid", "p_client_op_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_entry_with_op"("p_entry_id" "uuid", "p_client_op_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_catalog_items_usage_order"("p_dog_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_catalog_items_usage_order"("p_dog_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_catalog_items_usage_order"("p_dog_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_daily_kcal_totals"("p_dog_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_daily_kcal_totals"("p_dog_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_daily_kcal_totals"("p_dog_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_or_create_day"("p_dog_id" "uuid", "p_date" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."get_or_create_day"("p_dog_id" "uuid", "p_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_or_create_day"("p_dog_id" "uuid", "p_date" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."move_entry"("p_entry_id" "uuid", "p_dir" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."move_entry"("p_entry_id" "uuid", "p_dir" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."move_entry"("p_entry_id" "uuid", "p_dir" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."reorder_entries"("p_day_id" "uuid", "p_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."reorder_entries"("p_day_id" "uuid", "p_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."reorder_entries"("p_day_id" "uuid", "p_ids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."reorder_entries"("p_day_id" "uuid", "p_ids" "uuid"[], "p_client_op_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."reorder_entries"("p_day_id" "uuid", "p_ids" "uuid"[], "p_client_op_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reorder_entries"("p_day_id" "uuid", "p_ids" "uuid"[], "p_client_op_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_entry_qty_and_status"("p_entry_id" "uuid", "p_qty" numeric, "p_next_status" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."update_entry_qty_and_status"("p_entry_id" "uuid", "p_qty" numeric, "p_next_status" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_entry_qty_and_status"("p_entry_id" "uuid", "p_qty" numeric, "p_next_status" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_entry_qty_and_status"("p_entry_id" "uuid", "p_qty" numeric, "p_next_status" "text", "p_client_op_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."update_entry_qty_and_status"("p_entry_id" "uuid", "p_qty" numeric, "p_next_status" "text", "p_client_op_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_entry_qty_and_status"("p_entry_id" "uuid", "p_qty" numeric, "p_next_status" "text", "p_client_op_id" "uuid") TO "service_role";



GRANT ALL ON TABLE "public"."catalog_items" TO "anon";
GRANT ALL ON TABLE "public"."catalog_items" TO "authenticated";
GRANT ALL ON TABLE "public"."catalog_items" TO "service_role";



GRANT ALL ON TABLE "public"."days" TO "anon";
GRANT ALL ON TABLE "public"."days" TO "authenticated";
GRANT ALL ON TABLE "public"."days" TO "service_role";



GRANT ALL ON TABLE "public"."dogs" TO "anon";
GRANT ALL ON TABLE "public"."dogs" TO "authenticated";
GRANT ALL ON TABLE "public"."dogs" TO "service_role";



GRANT ALL ON TABLE "public"."entries" TO "anon";
GRANT ALL ON TABLE "public"."entries" TO "authenticated";
GRANT ALL ON TABLE "public"."entries" TO "service_role";



GRANT ALL ON TABLE "public"."goals" TO "anon";
GRANT ALL ON TABLE "public"."goals" TO "authenticated";
GRANT ALL ON TABLE "public"."goals" TO "service_role";



GRANT ALL ON TABLE "public"."weights" TO "anon";
GRANT ALL ON TABLE "public"."weights" TO "authenticated";
GRANT ALL ON TABLE "public"."weights" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







RESET ALL;
