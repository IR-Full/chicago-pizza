-- Opening hours become minutes from midnight, and a branch gains a floor.
--
-- The chain opens at 11:30, which a whole-hour column cannot hold: rounding
-- down takes orders before anyone is there, rounding up turns customers away
-- for half an hour. One branch also works 11:30 -> 6:00, so `closeMinute` is
-- allowed to be lower than `openMinute` and means "past midnight".
--
-- Converted in place rather than dropped and re-added: existing rows carry
-- real hours an administrator may have set, and multiplying by 60 preserves
-- every one of them exactly.

ALTER TABLE "branches" ADD COLUMN "floor" TEXT;

ALTER TABLE "branches" ADD COLUMN "openMinute" INTEGER NOT NULL DEFAULT 690;
ALTER TABLE "branches" ADD COLUMN "closeMinute" INTEGER NOT NULL DEFAULT 1410;

UPDATE "branches"
SET "openMinute"  = "openingHour" * 60,
    -- 24:00 was how the old column spelled midnight; as a minute count that
    -- is 1440, which is out of range for a clock reading. It becomes 0, and
    -- 0 <= openMinute is exactly the wrap case the new comparison handles.
    "closeMinute" = CASE WHEN "closingHour" >= 24 THEN 0 ELSE "closingHour" * 60 END;

ALTER TABLE "branches" DROP COLUMN "openingHour";
ALTER TABLE "branches" DROP COLUMN "closingHour";

-- Coordinates become optional. The real addresses come off a printed menu,
-- which gives a street and a number and no coordinates; a guessed pin is
-- worse than no pin. Nothing plots them today — delivery picks a branch by
-- zone polygon, not by distance.
ALTER TABLE "branches" ALTER COLUMN "lat" DROP NOT NULL;
ALTER TABLE "branches" ALTER COLUMN "lng" DROP NOT NULL;
