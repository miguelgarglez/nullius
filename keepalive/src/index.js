// nullius keep-alive: one cheap read of the claims ledger every 3 days.
// A PostgREST request counts as activity, so the shared free-tier project
// never pauses underneath a live portfolio piece.
export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      fetch(`${env.SUPABASE_URL}/rest/v1/claims?select=feature_key&limit=1`, {
        headers: { apikey: env.SUPABASE_KEY, 'Accept-Profile': 'nullius' },
      }).then((r) => {
        if (!r.ok) console.error(`keepalive read failed: ${r.status}`);
      }),
    );
  },
};
