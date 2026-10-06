-- Store and retrieve the rotating Fortnite refresh token through Supabase Vault.

create or replace function public.get_fortnite_refresh_token()
returns text
language sql
security definer
set search_path = ''
as $$
    select decrypted_secret
    from vault.decrypted_secrets
    where name = 'fortnite_refresh_token'
    limit 1;
$$;


create or replace function public.update_fortnite_refresh_token(
    new_token text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    secret_id uuid;
begin
    select id
    into secret_id
    from vault.secrets
    where name = 'fortnite_refresh_token'
    limit 1;

    if secret_id is null then
        perform vault.create_secret(
            new_token,
            'fortnite_refresh_token',
            'Fortnite rotating refresh token'
        );
    else
        perform vault.update_secret(
            secret_id,
            new_token
        );
    end if;
end;
$$;


revoke all on function public.get_fortnite_refresh_token() from public;
revoke all on function public.get_fortnite_refresh_token() from anon;
revoke all on function public.get_fortnite_refresh_token() from authenticated;

revoke all on function public.update_fortnite_refresh_token(text) from public;
revoke all on function public.update_fortnite_refresh_token(text) from anon;
revoke all on function public.update_fortnite_refresh_token(text) from authenticated;


grant execute on function public.get_fortnite_refresh_token() to service_role;
grant execute on function public.update_fortnite_refresh_token(text) to service_role;


-- Display Supabase Cron execution times in Eastern Time.

create or replace view public.cron_run_history_eastern as
select
    j.jobname,
    r.status,
    to_char(
        r.start_time at time zone 'America/New_York',
        'Mon DD, YYYY HH12:MI:SS AM'
    ) as started_eastern,
    to_char(
        r.end_time at time zone 'America/New_York',
        'Mon DD, YYYY HH12:MI:SS AM'
    ) as finished_eastern,
    round(
        extract(epoch from (r.end_time - r.start_time)) * 1000
    )::bigint as duration_ms,
    r.return_message
from cron.job_run_details r
left join cron.job j
    on j.jobid = r.jobid
order by r.start_time desc;