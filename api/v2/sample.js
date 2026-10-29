// Распознавание скриншотов и AI-резюме для KaizenHub v2: та же функция, что /api/sample,
// но вход проверяется в проекте Supabase версии v2 (переменные V2_SUPABASE_URL и V2_SUPABASE_PUBLISHABLE_KEY в Vercel).
// У каждой функции Vercel свой процесс, поэтому замена переменных здесь не влияет на основную версию.
if (process.env.V2_SUPABASE_URL) process.env.SUPABASE_URL = process.env.V2_SUPABASE_URL;
if (process.env.V2_SUPABASE_PUBLISHABLE_KEY) process.env.SUPABASE_PUBLISHABLE_KEY = process.env.V2_SUPABASE_PUBLISHABLE_KEY;
module.exports = require('../sample.js');
