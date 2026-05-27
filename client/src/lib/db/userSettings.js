import { supabase } from "../supabase.js";

const DEFAULT_TARGET = { kr: 30, us: 50, crypto: 20 };
const DEFAULT_FX = 1380;

export async function getSettings() {
  const { data, error } = await supabase
    .from("user_settings").select("target, fx_rate").maybeSingle();
  if (error) throw error;
  if (!data) {
    // 첫 호출이면 insert (트리거가 user_id 주입)
    const { data: ins, error: e2 } = await supabase
      .from("user_settings").insert({}).select().single();
    if (e2) throw e2;
    return { target: ins.target, fxRate: Number(ins.fx_rate) };
  }
  return { target: data.target, fxRate: Number(data.fx_rate) };
}

// PostgREST refuses UPDATE without a WHERE filter (21000), so we scope to the
// authenticated user explicitly. RLS would already enforce this, but PostgREST
// still requires us to be explicit.
async function currentUserId() {
  // getSession() reads from localStorage; getUser() would hit /auth/v1/user
  // over the network each call.
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) throw new Error("not_authenticated");
  return session.user.id;
}

export async function updateTarget(target) {
  const uid = await currentUserId();
  const { data, error } = await supabase
    .from("user_settings").update({ target }).eq("user_id", uid).select().single();
  if (error) throw error;
  return data.target;
}

export async function updateFxRate(fxRate) {
  const uid = await currentUserId();
  const { data, error } = await supabase
    .from("user_settings").update({ fx_rate: fxRate }).eq("user_id", uid).select().single();
  if (error) throw error;
  return Number(data.fx_rate);
}

export const DEFAULTS = { target: DEFAULT_TARGET, fxRate: DEFAULT_FX };
