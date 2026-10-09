// nullius keep-alive: one cheap read of the claims ledger once a day.
// PostgREST requests count as activity — best-effort so the shared
// free-tier project does not idle into a pause under a live chart.
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
