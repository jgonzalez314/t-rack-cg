-- Lets folders be put in any order on the home screen. Lower comes first.
-- Folders with no sort_order (all folders made before this, and new ones)
-- come after the ordered ones, by name, so the list keeps its A to Z order
-- until someone reorders it.

alter table public.folders
  add column sort_order integer check (sort_order >= 0);
