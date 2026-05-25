-- Enable Supabase Realtime on the tables that the app subscribes to.
--
-- The app's useLists + useListItems hooks open postgres_changes channels
-- on shopping.list_items, shopping.list_members, and shopping.purchase_events.
-- Without these tables in the supabase_realtime publication, no events
-- are broadcast — sharing/realtime collaboration never updates the other
-- user's view, and the E2E "B checks → A sees it" assertion times out.

alter publication supabase_realtime add table shopping.list_items;
alter publication supabase_realtime add table shopping.list_members;
alter publication supabase_realtime add table shopping.purchase_events;
