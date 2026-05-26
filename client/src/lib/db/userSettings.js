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

export async function updateTarget(target) {
  const { data, error } = await supabase
    .from("user_settings").update({ target }).select().single();
  if (error) throw error;
  return data.target;
}

export async function updateFxRate(fxRate) {
  const { data, error } = await supabase
    .from("user_settings").update({ fx_rate: fxRate }).select().single();
  if (error) throw error;
  return Number(data.fx_rate);
}

export const DEFAULTS = { target: DEFAULT_TARGET, fxRate: DEFAULT_FX };
