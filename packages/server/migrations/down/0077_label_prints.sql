-- Takes the print of a label out again, back to how 0076 left things: a
-- label bears only the moment it was made. Run as the superuser, like every
-- rollback.
ALTER TABLE "labels" DROP COLUMN "print_id";
