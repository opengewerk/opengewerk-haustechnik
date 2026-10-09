-- Rolling the frozen states of the rounds and the PDFs back to how 0033 left
-- the database.
--
-- What it costs an installation that runs it: the frozen state of every
-- round written down since, and the record of which PDF was made of which
-- frozen state. The PDFs stay in the store as files of their tenant; a PDF
-- asked for again is made again, and it may differ in its bytes. The triggers
-- refuse to empty the tables, so they go as they are.

DROP TABLE "prints";--> statement-breakpoint
DROP TABLE "round_records";--> statement-breakpoint
DROP FUNCTION "print_kept_as_written"();
