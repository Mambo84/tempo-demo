-- M11 pull-forward — copyable invite links.
--
-- get_invitation_preview(id): lets the /#invite=<id> landing page show "X invited
-- you as <role>" and pre-fill the invited email BEFORE the visitor is logged in.
-- RLS on `invitations` is inviter-only and profiles are owner-only, so a logged-out
-- (or wrong-account) visitor can't read either directly — hence a SECURITY DEFINER
-- reader granted to `anon`.
--
-- SECURITY / SHARED-SECRET MODEL (Brad's accepted risk): anyone holding the
-- invitation UUID can read the invited email + inviter name + role. Acceptable for
-- pilot — UUIDs aren't enumerable, and invites are single-use, revocable, and
-- expire. Only PENDING, unexpired invites are returned (empty otherwise), so
-- accepted/revoked invites leak nothing. No signed tokens (out of scope for pilot).

create or replace function public.get_invitation_preview(p_invitation_id uuid)
returns table (
  invited_email text,
  inviter_name  text,
  inviter_title text,
  role          text,
  athlete_name  text,
  direction     text
)
language sql
security definer
set search_path = public
as $$
  select
    i.invited_email,
    coalesce(p.display_name, 'Someone') as inviter_name,
    coalesce(p.title, '')               as inviter_title,
    i.role,
    i.athlete_name,
    i.direction
  from public.invitations i
  left join public.profiles p on p.id = i.inviter_user_id
  where i.id = p_invitation_id
    and i.status = 'pending'
    and (i.expires_at is null or i.expires_at > now());
$$;

grant execute on function public.get_invitation_preview(uuid) to anon, authenticated;
