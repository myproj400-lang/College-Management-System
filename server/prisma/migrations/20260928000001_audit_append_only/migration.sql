-- SEC-04/SRS-063: audit evidence must not be alterable by ordinary
-- application roles, and tampering must be detectable. Prisma has no
-- first-class "append-only table" concept, so this is expressed as plain
-- SQL rules: any UPDATE or DELETE issued against audit_event by the
-- application's own database role is silently turned into a no-op rather
-- than mutating history.
--
-- This is a baseline control, not the complete story: a database
-- superuser can still drop the rule. Production operation should also
-- run the application under a role that does not own these rules and
-- ship them to a separate, more privileged migration role - tracked as
-- an operational follow-up (see server/README.md).
CREATE RULE audit_event_no_update AS ON UPDATE TO "audit_event" DO INSTEAD NOTHING;
CREATE RULE audit_event_no_delete AS ON DELETE TO "audit_event" DO INSTEAD NOTHING;
