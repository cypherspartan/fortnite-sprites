-- ============================================================
-- Fortnite Sprite Collection Cron Failure Monitor
-- ============================================================

create table if not exists public.fortnite_cron_monitor_state (
    id boolean primary key default true,
    last_alerted_run_id bigint,
    updated_at timestamptz not null default now(),

    constraint fortnite_cron_monitor_state_singleton
        check (id = true)
);


create or replace function public.get_fortnite_cron_status()
returns table (
    run_id bigint,
    status text,
    started_eastern text,
    finished_eastern text,
    return_message text
)
language sql
security definer
set search_path = ''
as $$
    select
        r.runid as run_id,
        r.status,
        to_char(
            r.start_time at time zone 'America/New_York',
            'Mon DD, YYYY HH12:MI:SS AM'
        ) as started_eastern,
        to_char(
            r.end_time at time zone 'America/New_York',
            'Mon DD, YYYY HH12:MI:SS AM'
        ) as finished_eastern,
        r.return_message
    from cron.job_run_details r
    join cron.job j
        on j.jobid = r.jobid
    where j.jobname = 'Update Fortnite Sprite Collection'
    order by r.start_time desc
    limit 1;
$$;


create or replace function public.get_fortnite_cron_last_alerted_run()
returns bigint
language sql
security definer
set search_path = ''
as $$
    select last_alerted_run_id
    from public.fortnite_cron_monitor_state
    where id = true;
$$;


create or replace function public.set_fortnite_cron_last_alerted_run(
    new_run_id bigint
)
returns void
language sql
security definer
set search_path = ''
as $$
    insert into public.fortnite_cron_monitor_state (
        id,
        last_alerted_run_id,
        updated_at
    )
    values (
        true,
        new_run_id,
        now()
    )
    on conflict (id)
    do update set
        last_alerted_run_id = excluded.last_alerted_run_id,
        updated_at = now();
$$;


revoke all on function public.get_fortnite_cron_status()
from public;

revoke all on function public.get_fortnite_cron_status()
from anon;

revoke all on function public.get_fortnite_cron_status()
from authenticated;


revoke all on function public.get_fortnite_cron_last_alerted_run()
from public;

revoke all on function public.get_fortnite_cron_last_alerted_run()
from anon;

revoke all on function public.get_fortnite_cron_last_alerted_run()
from authenticated;


revoke all on function public.set_fortnite_cron_last_alerted_run(bigint)
from public;

revoke all on function public.set_fortnite_cron_last_alerted_run(bigint)
from anon;

revoke all on function public.set_fortnite_cron_last_alerted_run(bigint)
from authenticated;


grant execute on function public.get_fortnite_cron_status()
to service_role;

grant execute on function public.get_fortnite_cron_last_alerted_run()
to service_role;

grant execute on function public.set_fortnite_cron_last_alerted_run(bigint)
to service_role;


revoke all on table public.fortnite_cron_monitor_state
from public;

revoke all on table public.fortnite_cron_monitor_state
from anon;

revoke all on table public.fortnite_cron_monitor_state
from authenticated;
