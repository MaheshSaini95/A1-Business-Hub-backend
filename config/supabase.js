// config/supabase.js
const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

console.log("🔍 Supabase config check:");
console.log("SUPABASE_URL:", supabaseUrl ? "✅ Loaded" : "❌ Missing");
console.log("SUPABASE_SERVICE_KEY:", supabaseKey ? "✅ Loaded" : "❌ Missing");

if (!supabaseUrl || !supabaseKey) {
  console.error(`
❌ SUPABASE CONFIG ERROR!
1. Check .env file exists in project root
2. SUPABASE_URL=https://your-project.supabase.co
3. SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIs... (Service Role Key)

Get from: Supabase Dashboard → Settings → API
  `);
  process.exit(1);
}

const supabaseAdmin = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

console.log("✅ Supabase Admin client created");
module.exports = { supabaseAdmin };
