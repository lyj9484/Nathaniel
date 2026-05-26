import { supabase } from "../supabase.js";

export async function listHoldings() {
  const { data, error } = await supabase
    .from("holdings")
    .select("id, category, symbol, name, created_at")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}

export async function addHolding({ category, symbol, name }) {
  // user_id는 트리거가 auth.uid()로 강제 주입
  const { data, error } = await supabase
    .from("holdings")
    .insert({ category, symbol, name })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function removeHolding(id) {
  const { error } = await supabase.from("holdings").delete().eq("id", id);
  if (error) throw error;
}

export async function updateHoldingName(id, name) {
  const { data, error } = await supabase
    .from("holdings").update({ name }).eq("id", id).select().single();
  if (error) throw error;
  return data;
}
