# MCP Guide — Letting Claude manage your shopping data

This app's database is designed to be safely managed by Claude through the **Supabase MCP server**. RLS guarantees Claude can only see/modify data belonging to the signed-in user.

## Setup

1. In your Claude client (Claude Desktop or Claude Code), add the Supabase MCP server with your project URL and a service-role or anon key bound to your user.
2. Verify Claude can read the schema: ask *"What tables exist?"* — it should list `shopping_lists`, `list_items`, `purchase_events`, `purchase_event_items`, `list_members`, plus the views `v_list_participants`, `v_monthly_purchase_summary`, `v_item_frequency`.

## Useful prompts

- **Add an item:** "Add חלב 3% to my default list."
  Claude calls `add_item(p_list_id=<default>, p_name='חלב 3%', p_qty=1, p_unit='ליטר')`.
- **Spend report:** "How much did I spend on groceries last month?"
  Claude queries `v_monthly_purchase_summary`.
- **Frequency:** "What do I buy most often?"
  Claude queries `v_item_frequency`.
- **Share:** "Share my weekly list with partner@example.com."
  Claude calls `share_list(p_list_id=<weekly>, p_email='partner@example.com')`.

## Safety

- RLS enforces row ownership at the DB level — Claude cannot read data outside your user, even if asked.
- All write paths go through `SECURITY INVOKER` functions (`add_item`, `complete_checkout`, `share_list`, `unshare_list`, `archive_list`, `create_list`) — your user's permissions apply.
- The `delete_list_permanently` RPC is destructive; require an explicit confirmation in your prompt.
