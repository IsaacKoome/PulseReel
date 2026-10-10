begin;

-- Likes and follows use INSERT ... ON CONFLICT DO UPDATE, which requires
-- UPDATE permission even when a new row does not conflict.
grant update on public.pulse_reel_movie_likes,
  public.pulse_reel_creator_follows to service_role;

commit;
