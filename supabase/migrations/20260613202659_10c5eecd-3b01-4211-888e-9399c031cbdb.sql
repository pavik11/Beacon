ALTER TABLE public.pins DROP CONSTRAINT IF EXISTS pins_category_check;
UPDATE public.pins SET category = 'water_fountain' WHERE category = 'water';
UPDATE public.pins SET category = 'bathroom'       WHERE category = 'restroom';
UPDATE public.pins SET category = 'shelter'        WHERE category = 'sanctuary';
ALTER TABLE public.pins
  ADD CONSTRAINT pins_category_check
  CHECK (category IN ('water_fountain','bathroom','food','transportation','shelter','temple','church','mosque','library'));