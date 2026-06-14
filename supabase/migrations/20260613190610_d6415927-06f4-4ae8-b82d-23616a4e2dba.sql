
CREATE TABLE public.pins (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  category TEXT NOT NULL CHECK (category IN ('water','restroom','food','sanctuary')),
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  description TEXT,
  upvotes INTEGER NOT NULL DEFAULT 0,
  downvotes INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.pins TO anon, authenticated;
GRANT ALL ON public.pins TO service_role;

ALTER TABLE public.pins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read pins" ON public.pins FOR SELECT USING (true);
CREATE POLICY "Anyone can add pins" ON public.pins FOR INSERT WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.vote_on_pin(pin_id UUID, vote_type TEXT)
RETURNS public.pins
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result public.pins;
BEGIN
  IF vote_type NOT IN ('up','down') THEN
    RAISE EXCEPTION 'invalid vote_type';
  END IF;
  IF vote_type = 'up' THEN
    UPDATE public.pins SET upvotes = upvotes + 1, updated_at = now()
    WHERE id = pin_id RETURNING * INTO result;
  ELSE
    UPDATE public.pins SET downvotes = downvotes + 1, updated_at = now()
    WHERE id = pin_id RETURNING * INTO result;
  END IF;
  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.vote_on_pin(UUID, TEXT) TO anon, authenticated;

ALTER PUBLICATION supabase_realtime ADD TABLE public.pins;
