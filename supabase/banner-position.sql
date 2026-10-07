-- Lets each homepage banner photo remember which part of the photo shows (0 = top, 100 = bottom).
alter table banner_slides add column if not exists focus_y int not null default 50;
