-- The document that bears the interval of a duty (#74, section 4.3 of the
-- concept): "Frist festlegen ... mit Begründung und Verweis auf das Dokument,
-- das sie trägt (Gefährdungsbeurteilung). Der Verweis ist empfohlen und nicht
-- verlangt; er merkt sich die Fassung des Dokuments vom Tag der Bestätigung."
--
-- A duty names the document and the version of it the reference was set
-- with, both or neither. The document is one of the property of the duty, so
-- that it lies in the same area and whoever sees the duty sees it; the
-- version is one of that document. Each key runs over a unique key the
-- document and its versions are given here, which comes first. Which records
-- of the property the document may hang on, the route asks.
--
-- Nothing is written to a row: every duty there is names no document.
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_on_their_property" UNIQUE("tenant_id","id","property_id");--> statement-breakpoint
ALTER TABLE "attachment_versions" ADD CONSTRAINT "attachment_versions_of_their_document" UNIQUE("tenant_id","id","attachment_id");--> statement-breakpoint
ALTER TABLE "duties" ADD COLUMN "interval_document_id" uuid;--> statement-breakpoint
ALTER TABLE "duties" ADD COLUMN "interval_document_version_id" uuid;--> statement-breakpoint
ALTER TABLE "duties" ADD CONSTRAINT "duties_interval_document_of_their_property" FOREIGN KEY ("tenant_id","interval_document_id","property_id") REFERENCES "public"."attachments"("tenant_id","id","property_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duties" ADD CONSTRAINT "duties_interval_document_version_of_it" FOREIGN KEY ("tenant_id","interval_document_version_id","interval_document_id") REFERENCES "public"."attachment_versions"("tenant_id","id","attachment_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duties" ADD CONSTRAINT "duties_interval_document_whole" CHECK (("duties"."interval_document_id" is null) = ("duties"."interval_document_version_id" is null));
